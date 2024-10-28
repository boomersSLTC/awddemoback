const express = require('express');
const mssql = require('mssql');
const cors = require('cors');
const jwt = require('jsonwebtoken')
const { createServer, maxHeaderSize } = require("http");
const nodemailer = require("nodemailer");
require('dotenv').config();
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);
const { Server } = require("socket.io");
const app = express();

const httpServer = createServer(app);
const port = process.env.PORT || 3000;
const revokedTokens = new Set();

const io = new Server(httpServer);

app.use(cors());
app.use(express.json());

// Database configuration

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    trustServerCertificate: true,
    trustedconnection: true,
    enableArithAbort: true,
  },
};

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function connectToDatabase() {
  try {
    await mssql.connect(config);
    console.log('Connected to SQL Server');
  } catch (err) {
    console.error('Error connecting to SQL Server:', err);
  }
}

const jwtMiddleware = (req, res, next) => {
  const token = req.header('x-auth-token'); // Assuming you send the token in the 'x-auth-token' header

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Attach the decoded user information to the request object
    next();
  } catch (ex) {
    res.status(400).json({ error: 'Invalid token.' });
  }
};

//USER 

app.post('/login', async (req, res) => {
  const { usernameOrEmail, password, wd, org, EN } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UsernameOrEmail', mssql.NVarChar(255), usernameOrEmail);
    request.input('Password', mssql.NVarChar(255), escape(password));


    const result = await request.execute('GetUpdateLogin_Mobile');

    if (result.returnValue === 0) {
      return res.status(401).json({ error: 'User not found' });
    } else if (result.returnValue === 1) {
      const userRecord = result.recordset;
      // Assuming the recordset contains the user information

      //Executes Updating Online
      const request2 = new mssql.Request();
      request2.input('UI', mssql.Int, userRecord[0][["UserIdN"]]);
      request2.input('WS', mssql.Int, wd);
      request2.input('BR', mssql.NVarChar(mssql.MAX), '');
      request2.input('SS', mssql.NVarChar(mssql.MAX), '');
      await request2.execute('UpdateOnline');

      //Executes Get Online Users
      const request3 = new mssql.Request();
      request3.input('UI', mssql.Int, userRecord[0][["UserIdN"]]);
      request3.input('WD', mssql.Int, wd);

      const result3 = await request3.execute('GetOnlineUsersOfWorkDomain');
      io.emit('onlineUsersData', result3.recordset);


      // Execute getUsersData
      const getUsersRequest = new mssql.Request();
      getUsersRequest.input('ws', mssql.Int, wd);
      getUsersRequest.input('UI', mssql.Int, userRecord[0][["UserIdN"]]);
      getUsersRequest.input('sEN', mssql.NVarChar(255), EN);
      const usersResult = await getUsersRequest.execute('GetUsers');

      const users = usersResult.recordset;
      // Generate a token upon successful login
      const token = jwt.sign({ usernameOrEmail }, process.env.JWT_SECRET, {
        expiresIn: '1h', // Set the expiration time as needed
      });

      // Return the user record and token in the response
      return res.status(200).json({ user: userRecord, token, users });
    } else {
      return res.status(401).json({ error: 'Invalid password' });
    }
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/logout', async (req, res) => {
  const { userId, wd } = req.body; // Assuming you send the userId of the logged-out user in the request body
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UI', mssql.Int, userId);
    request.input('WS', mssql.Int, wd);
    request.input('BR', mssql.VarChar(mssql.MAX), '');

    await request.execute('UpdateOnline_Del');
    return res.status(200).json({ message: 'Logout successful' });
  } catch (err) {
    console.error('Error during logout:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


//EMAIL

app.post('/getSentEmails/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { MyTime, wd, cnt, blocksize } = req.body;

  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('ID', mssql.Int, userId);
    request.input('WS', mssql.Int, wd);
    request.input('MyTime', mssql.NVarChar(mssql.MAX), MyTime);
    request.input('SR', mssql.NVarChar(mssql.MAX), '');
    request.input('S2U', mssql.VarChar(5), 'false');
    request.input('BorCols', mssql.Int, 1);
    request.input('Cnt', mssql.VarChar(6), cnt);
    request.input('BlckSize', mssql.Int, blocksize);

    const result = await request.execute('GetMailSentbox2023_Mobile');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching received emails:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/getReceivedEmails/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { MyTime, wd, cnt, blocksize } = req.body;

  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('ID', mssql.Int, userId);
    request.input('WS', mssql.Int, wd);
    request.input('MyTime', mssql.NVarChar(mssql.MAX), MyTime);
    request.input('SR', mssql.NVarChar(50), '');
    request.input('SRNoEn', mssql.NVarChar(50), '');
    request.input('S2U', mssql.VarChar(5), 'false');
    request.input('BorCols', mssql.Int, 1);
    request.input('Cnt', mssql.VarChar(5), cnt);
    request.input('BlckSize', mssql.Int, blocksize);

    const result = await request.execute('GetMailInbox2023_Mobile');

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching sent emails:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/getAllEmails/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { MyTime, wd, cnt, blocksize } = req.body;

  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('ID', mssql.Int, userId);
    request.input('WS', mssql.Int, wd);
    request.input('MyTime', mssql.NVarChar(mssql.MAX), MyTime);
    request.input('SR', mssql.NVarChar(mssql.MAX), '');
    request.input('BorCols', mssql.Int, 1);
    request.input('Cnt', mssql.VarChar(6), cnt);
    request.input('BlckSize', mssql.Int, blocksize);

    const result = await request.execute('GetMailInboxAndSent2023_Mobile');

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching emails:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// app.post('/composeMail', jwtMiddleware, async (req, res) => {
//   const { to_id, to_email, from_id, subject, body, to_cellphone, at, wd } = req.body;
//   console.log(req.body)
//   try {
//     await connectToDatabase();
//     const request1 = new mssql.Request();
//     const result = await request1.execute('GetNextMobileCode');

//     const request = new mssql.Request();
//     request.input('TO', mssql.Int, to_id);
//     request.input('S', mssql.NVarChar(mssql.MAX), escape(subject));
//     request.input('At', mssql.NVarChar(10), '0');
//     request.input('iCC', mssql.Int, 0);
//     request.input('CC', mssql.NVarChar(mssql.MAX), '');
//     request.input('FR', mssql.Int, from_id);
//     request.input('B', mssql.NVarChar(mssql.MAX), escape(body));
//     request.input('ThId', mssql.Int, 0);
//     request.input('sRefID', mssql.NVarChar(9), result.recordset[0].Code_Mobile);
//     // Adjusting the 'EM' and 'SMS' inputs based on the presence of to_email and to_cellphone
//     if (to_email && to_cellphone) {
//       request.input('EM', mssql.Int, 1);
//       request.input('SMS', mssql.Int, 1);
//     } else if (to_email) {
//       request.input('EM', mssql.Int, 1);
//       request.input('SMS', mssql.Int, 0);
//     } else if (to_cellphone) {
//       request.input('EM', mssql.Int, 0);
//       request.input('SMS', mssql.Int, 1);
//     } else {
//       request.input('EM', mssql.Int, 0);
//       request.input('SMS', mssql.Int, 0);
//     }
//     request.input('A', mssql.NVarChar(mssql.MAX), '');
//     request.input('RqstEmlWhnRply', mssql.Int, 0);
//     request.input('RqstSMSWhnRply', mssql.Int, 0);
//     request.input('WD', mssql.Int, wd);
//     request.input('ToOriginal', mssql.Int, to_id);
//     request.input('GroupIDs', mssql.NVarChar(mssql.MAX), '');
//     // Call the stored procedure to compose and save the email 

//     const mailResult = await request.execute('InsertMail');

//     if (to_cellphone && to_email) {
//       await transporter.sendMail({
//         from: 'anzee.donotreply1@anzeewd.com',
//         to: to_email,
//         subject: subject,
//         text: body,
//         html: `<b>${body}</b>`,
//       })

//       client.messages
//         .create({
//           body: 'Mail Received please check Anzee',
//           from: '+1 925 261 7061',
//           to: to_cellphone
//         })
//         .then(message => console.log(message.sid));
//     } else if (to_email) {
//       // Send the email only if to_email is provided
//       await transporter.sendMail({
//         from: 'anzee.donotreply1@anzeewd.com',
//         to: to_email,
//         subject: subject,
//         text: body,
//         html: `<b>${body}</b>`,
//       });
//     } else if (to_cellphone) {
//       client.messages
//         .create({
//           body: 'Mail Received please check Anzee',
//           from: '+1 925 261 7061',
//           to: to_cellphone
//         })
//         .then(message => console.log(message.sid));
//     }

//     res.status(200).json({ message: 'Email composed and sent successfully' });
//   } catch (err) {
//     console.error('Error composing email:', err);
//     res.status(500).json({ error: 'Server error' });
//   }
// });

app.post('/composeMail', jwtMiddleware, async (req, res) => {
  const { cc_list, to_id, to_email, from_id, subject, body, to_cellphone, at, wd } = req.body;
  console.log(req.body);

  try {
    await connectToDatabase();
    const request1 = new mssql.Request();
    const result = await request1.execute('GetNextMobileCode');
    console.log(result)

    // Convert CC list to a comma-separated string
    const ccListString = cc_list ? cc_list.join(',') : '';


    if (cc_list && cc_list.length > 0) {
      // Send email to the primary recipient first
      await sendEmail(to_id, to_email, to_cellphone, from_id, subject, body, wd, result.recordset[0].Code_Mobile, ccListString, to_id);

      // Handle CC list
      for (const ccId of cc_list) {
        await sendEmail(ccId, to_email, to_cellphone, from_id, subject, body, wd, result.recordset[0].Code_Mobile, ccListString, to_id);
      }
    } else {
      await sendEmail(to_id, to_email, to_cellphone, from_id, subject, body, wd, result.recordset[0].Code_Mobile, ccListString, to_id);
    }

    res.status(200).json({ message: 'Email composed and sent successfully' });
  } catch (err) {
    console.error('Error composing email:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

function htmlToTextConverted(htmlContent) {
  var textContent = htmlContent
    .replace(/<p[^>]*>/g, ' ')
    .replace(/<\/p>/g, ' ')
    .replace(/<div[^>]*>/g, ' ')
    .replace(/<\/div>/g, ' ')
    .replace(/<br[^>]*>/g, ' ')
    .replace(/<h[1-6][^>]*>/g, ' ')
    .replace(/<\/h[1-6]>/g, ' ')
    .replace(/<ul[^>]*>/g, ' ')
    .replace(/<\/ul>/g, ' ')
    .replace(/<ol[^>]*>/g, ' ')
    .replace(/<\/ol>/g, ' ')
    .replace(/<li[^>]*>/g, ' ')
    .replace(/<\/li>/g, ' ')
    .replace(/<hr[^>]*>/g, ' ')
    .replace(/<blockquote[^>]*>/g, ' ')
    .replace(/<\/blockquote>/g, ' ')
    .replace(/<pre[^>]*>/g, ' ')
    .replace(/<\/pre>/g, ' ')
    .replace(/<address[^>]*>/g, ' ')
    .replace(/<\/address>/g, ' ')
    .replace(/<fieldset[^>]*>/g, ' ')
    .replace(/<\/fieldset>/g, ' ')
    .replace(/<article[^>]*>/g, ' ')
    .replace(/<\/article>/g, ' ')
    .replace(/<aside[^>]*>/g, ' ')
    .replace(/<\/aside>/g, ' ')
    .replace(/<details[^>]*>/g, ' ')
    .replace(/<\/details>/g, ' ')
    .replace(/<figcaption[^>]*>/g, ' ')
    .replace(/<\/figcaption>/g, ' ')
    .replace(/<figure[^>]*>/g, ' ')
    .replace(/<\/figure>/g, ' ')
    .replace(/<footer[^>]*>/g, ' ')
    .replace(/<\/footer>/g, ' ')
    .replace(/<header[^>]*>/g, ' ')
    .replace(/<\/header>/g, ' ')
    .replace(/<hgroup[^>]*>/g, ' ')
    .replace(/<\/hgroup>/g, ' ')
    .replace(/<main[^>]*>/g, ' ')
    .replace(/<\/main>/g, ' ')
    .replace(/<nav[^>]*>/g, ' ')
    .replace(/<\/nav>/g, ' ')
    .replace(/<section[^>]*>/g, ' ')
    .replace(/<\/section>/g, ' ')
    .replace(/<table[^>]*>/g, ' ')
    .replace(/<\/table>/g, ' ')
    .replace(/<tr[^>]*>/g, ' ')
    .replace(/<\/tr>/g, ' ')
    .replace(/<td[^>]*>/g, ' ')
    .replace(/<\/td>/g, ' ')
    .replace(/<th[^>]*>/g, ' ')
    .replace(/<\/th>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ');

  // Remove any remaining HTML tags
  textContent = textContent.replace(/<[^>]+>/g, '');

  // Trim and normalize whitespace
  textContent = textContent.trim().replace(/\s\s+/g, ' ');

  return textContent;
}



// Function to handle sending email/SMS
const sendEmail = async (recipientId, email, cellphone, fromId, subject, body, wd, refId, ccListString, to_id) => {
    // Convert HTML to text
  const plainText = htmlToTextConverted(body);
  const trimmedText = plainText.slice(0, 200);
  const request = new mssql.Request();
  request.input('TO', mssql.Int, recipientId || 0);
  request.input('S', mssql.NVarChar(mssql.MAX), escape(subject));
  request.input('At', mssql.NVarChar(10), '0');
  request.input('iCC', mssql.Int, 0);
  request.input('CC', mssql.NVarChar(mssql.MAX), ccListString); // Use the CC list string here
  request.input('FR', mssql.Int, fromId); // Use the from_id here
  request.input('B', mssql.NVarChar(mssql.MAX), escape(body));
  request.input('BSM', mssql.NVarChar(250), trimmedText);
  request.input('ThId', mssql.Int, 0);
  request.input('sRefID', mssql.NVarChar(9), refId);

  // Adjusting the 'EM' and 'SMS' inputs based on the presence of to_email and to_cellphone
  if (email && cellphone) {
    request.input('EM', mssql.Int, 1);
    request.input('SMS', mssql.Int, 1);
  } else if (email) {
    request.input('EM', mssql.Int, 1);
    request.input('SMS', mssql.Int, 0);
  } else if (cellphone) {
    request.input('EM', mssql.Int, 0);
    request.input('SMS', mssql.Int, 1);
  } else {
    request.input('EM', mssql.Int, 0);
    request.input('SMS', mssql.Int, 0);
  }

  request.input('A', mssql.NVarChar(mssql.MAX), '');
  request.input('RqstEmlWhnRply', mssql.Int, 0);
  request.input('RqstSMSWhnRply', mssql.Int, 0);
  request.input('WD', mssql.Int, wd);
  request.input('ToOriginal', mssql.Int, to_id);
  request.input('GroupIDs', mssql.NVarChar(mssql.MAX), '');

  // Call the stored procedure to compose and save the email 
  await request.execute('InsertMail');

  if (cellphone && email) {
    await transporter.sendMail({
      from: 'anzee.donotreply1@anzeewd.com',
      to: email,
      subject: subject,
      text: body,
      html: `<b>${body}</b>`,
    })

    client.messages
      .create({
        body: 'Mail Received please check Anzee',
        from: '+1 925 261 7061',
        to: cellphone
      })
      .then(message => console.log(message.sid));
  } else if (email) {
    // Send the email only if to_email is provided
    await transporter.sendMail({
      from: 'anzee.donotreply1@anzeewd.com',
      to: email,
      subject: subject,
      text: body,
      html: `<b>${body}</b>`,
    });
  } else if (cellphone) {
    client.messages
      .create({
        body: 'Mail Received please check Anzee',
        from: '+1 925 261 7061',
        to: cellphone
      })
      .then(message => console.log(message.sid));
  }
};


app.post('/updateEmailVisibility/:mailId/:userId', jwtMiddleware, async (req, res) => {
  const { mailId, userId } = req.params;
  const deleteType = req.body.B;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('U', mssql.Int, userId);
    request.input('ID', mssql.Int, mailId);
    request.input('CmTp', mssql.Char(1), 'E');
    request.input('B', mssql.Int, deleteType);

    // Call the stored procedure to update email visibility
    await request.execute('UpdateArchiveMail');
    res.status(200).json({ message: 'Email visibility updated successfully' });
  } catch (err) {
    console.error('Error updating email visibility:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/getMailBody/:MailIdN/:UserID/:FR', jwtMiddleware, async (req, res) => {
  const { MailIdN, UserID, FR } = req.params;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('ID', mssql.Int, MailIdN);
    request.input('U', mssql.Int, UserID);
    request.input('FR', mssql.Int, FR);
    const result = await request.execute('GetMailBodyOne');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching received emails:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


//TASK

app.post('/getTasksID/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { wd, cnt, blocksize } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('User', mssql.Int, userId);
    request.input('ws', mssql.Int, wd);
    request.input('sCom', mssql.NVarChar(1), 'N');
    request.input('sArc', mssql.NVarChar(1), 'N');
    request.input('PI', mssql.Int, 0);
    request.input('SS', mssql.NVarChar(1), '');
    request.input('Bonly', mssql.Char(1), '');
    request.input('Cnt', mssql.NVarChar(6), cnt);
    request.input('BlckSize', mssql.Int, blocksize);

    const result = await request.execute('GetTasksCompletionType_Mobile');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/getTaskBody/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { ID, wd } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UI', mssql.Int, userId);
    request.input('WS', mssql.Int, wd);
    request.input('ID', mssql.Int, ID);

    const result = await request.execute('GetTasksEditAllData');
    res.json(result.recordsets[3]);
  } catch (err) {
    console.error('Error fetching task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/taskTpView/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { ID, wd } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UI', mssql.Int, userId);
    request.input('WS', mssql.Int, wd);
    request.input('SubOrTask', mssql.VarChar(1), 'T');
    request.input('ID', mssql.Int, ID);

    const result = await request.execute('GetSubLessTime');
    res.json(result.recordsets[1]);
  } catch (err) {
    console.error('Error fetching task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


//SUBTASK

app.post('/getSubTasksID/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { wd, cnt, blocksize, TI } = req.body;

  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('User', mssql.Int, userId);
    request.input('ws', mssql.Int, wd);
    request.input('sCom', mssql.NVarChar(1), 'N');
    request.input('sArc', mssql.NVarChar(1), 'N');
    request.input('TI', mssql.Int, '');
    request.input('Cnt', mssql.NVarChar(6), cnt);
    request.input('BlckSize', mssql.Int, blocksize);

    const result = await request.execute('GetSubsCompletionType');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching sub task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/subTaskTpView/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { ID } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UI', mssql.Int, userId);
    request.input('SubOrTask', mssql.VarChar(1), 'S');
    request.input('ID', mssql.Int, ID);

    const result = await request.execute('GetSubTime');
    res.json(result.recordsets[1]);
  } catch (err) {
    console.error('Error fetching task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/getSubTaskBody/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { ID, wd, SI, TI } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UI', mssql.Int, userId);
    request.input('WS', mssql.Int, wd);
    request.input('ID', mssql.Int, ID);
    request.input('TI', mssql.Int, TI);
    request.input('SI', mssql.Int, SI);

    const result = await request.execute('GetSubsEditAllData');
    res.json(result.recordsets[3]);
  } catch (err) {
    console.error('Error fetching task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


//SEARCH

app.post('/searchDetails/:UserID', jwtMiddleware, async (req, res) => {
  const { UserID } = req.params;
  const { Keywords } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('AssigneeIdN', mssql.Int, UserID);
    request.input('SearchKeyword', mssql.NVarChar, Keywords);
    const result = await request.execute('SearchTasksByAssigneeId');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error searching task details:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/searchSubDetails/:UserID', jwtMiddleware, async (req, res) => {
  const { UserID } = req.params;
  const { Keywords } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('AssigneeIdN', mssql.Int, UserID);
    request.input('SearchKeyword', mssql.NVarChar, Keywords);
    const result = await request.execute('SearchSubTasks');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error searching task details:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/searchReceivedEmails/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { Keywords } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UserID', mssql.Int, userId);
    request.input('Keyphrase', mssql.NVarChar, Keywords);
    const result = await request.execute('SearchReceivedEmails');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error searching received emails:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/searchSentEmails/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { Keywords } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UserID', mssql.Int, userId);
    request.input('Keyphrase', mssql.NVarChar, Keywords);
    const result = await request.execute('SearchSentEmails');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error searching received emails:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/searchBothEmails/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { Keywords } = req.body;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UserID', mssql.Int, userId);
    request.input('Keyphrase', mssql.NVarChar, Keywords);
    const result = await request.execute('SearchBothEmails');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error searching received emails:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

//Time

app.post('/getTimeReport/:userId', jwtMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { wd, sd, ed } = req.body;
  console.log(wd)
  try {
    await connectToDatabase();
    const request = new mssql.Request();

    request.input('S', mssql.VarChar(20), sd);
    request.input('E', mssql.VarChar(20), ed);
    request.input('U', mssql.Int, userId);
    request.input('W', mssql.Int, wd);

    const result = await request.execute('GetTimeReporting');
    console.log(result)
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching sub task:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// Websocket connection
io.on('connection', (socket) => {

  // Handle user login
  socket.on('userOnlineStatus', async (data) => {

    if (data.status) {
      // Add user to online list (e.g., in-memory map)
      // Update database with last seen timestamp

      try {
        const request4 = new mssql.Request();
        request4.input('UI', mssql.Int, data.UserIdN);
        request4.input('WS', mssql.Int, data.wd);
        request4.input('BR', mssql.NVarChar(mssql.MAX), '');
        request4.input('SS', mssql.NVarChar(mssql.MAX), '');

        await request4.execute('UpdateOnline');

        const request5 = new mssql.Request();
        request5.input('UI', mssql.Int, data.UserIdN);
        request5.input('WD', mssql.Int, data.wd);

        const result = await request5.execute('GetOnlineUsersOfWorkDomain');
        // Emit the online users data back to the client
        console.log(result.recordset)
        io.emit('onlineUsersData', result.recordset);

      } catch (err) {
        console.error('Error during online:', err);
      }
    }
  });

});


app.use(jwtMiddleware); // Apply the middleware to all routes

httpServer.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Close the database connection when the server is shutting down
process.on('SIGINT', async () => {
  try {
    console.log('Closing database connection...');
    await mssql.close();
    console.log('Database connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('Error closing database connection:', error);
    process.exit(1);
  }
});


