const express = require('express');
const mssql = require('mssql');
const cors = require('cors');
const jwt = require('jsonwebtoken')
const nodemailer = require("nodemailer");
require('dotenv').config();
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);
const app = express();
const port = process.env.PORT || 3000;

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
        trustedconnection:  true,
        enableArithAbort:  true,
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

// Stored procedure to get sent emails
app.get('/getSentEmails/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UserIdN', mssql.Int, userId);
    const result = await request.execute('GetSentMails');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching sent emails:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    await mssql.close();
  }
});


// Stored procedure to get received emails
app.get('/getReceivedEmails/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UserIdN', mssql.Int, userId);
    const result = await request.execute('GetReceivedMails');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching received emails:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    await mssql.close();
  }
});

app.get('/getAllEmails/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
      await connectToDatabase();
      const request = new mssql.Request();
      request.input('UserIdN', mssql.Int, userId);
      const result = await request.execute('GetBothMails');

      res.json(result.recordset);
  } catch (err) {
      console.error('Error fetching emails:', err);
      res.status(500).json({ error: 'Server error' });
  } finally {
      await mssql.close();
  }
});


// Add this route to your Express.js backend
app.post('/composeMail', async (req, res) => {
  const { to_id, to_email, from_id, from_email, subject, body, to_cellphone } = req.body;

  try {
      await connectToDatabase();
      const request = new mssql.Request();
      request.input('FromUserIdN', mssql.Int, from_id);
      request.input('ToUserIdN', mssql.Int, to_id);
      request.input('Subject', mssql.NVarChar(255), subject);
      request.input('Body', mssql.NVarChar(mssql.MAX), body);

      // Call the stored procedure to compose and save the email
      await request.execute('ComposeAndSendMail');
      
      if (to_cellphone && to_email) {
        await transporter.sendMail({
          from: 'anzee.donotreply1@anzeewd.com',
          to: to_email,
          subject: subject,
          text: body,
          html: `<b>${body}</b>`,
        })

        client.messages
        .create({
          body: 'Mail Received please check Anzee',
          from: '+1 925 261 7061',
          to: to_cellphone
        })
        .then(message => console.log(message.sid));
      } else if (to_email) {
        // Send the email only if to_email is provided
        await transporter.sendMail({
          from: 'anzee.donotreply1@anzeewd.com',
          to: to_email,
          subject: subject,
          text: body,
          html: `<b>${body}</b>`,
        });
      } else if (to_cellphone) {
        client.messages
          .create({
            body: 'Mail Received please check Anzee',
            from: '+1 925 261 7061',
            to: to_cellphone
          })
          .then(message => console.log(message.sid));
      }

      res.status(200).json({ message: 'Email composed and sent successfully' });
  } catch (err) {
      console.error('Error composing email:', err);
      res.status(500).json({ error: 'Server error' });
  } finally {
      await mssql.close();
  }
});

app.get('/getUsers', async (req,res) => {

  try {
      await connectToDatabase();
      const request = new mssql.Request();
      const result = await request.execute('getUsersData');
      res.json(result.recordset);
  } catch (err) {
      console.error('Error composing email:', err);
      res.status(500).json({ error: 'Server error' });
  } finally {
      await mssql.close();
  }
});


app.post('/updateEmailVisibility/:emailId', async (req, res) => {
  const { emailId } = req.params;
  const deleteType = req.body.B;
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('MailIdN', mssql.Int, emailId);
    request.input('B', mssql.Int, deleteType);

    // Call the stored procedure to update email visibility
    await request.execute('UpdateEmailVisibility');
    console.log(deleteType)
    res.status(200).json({ message: 'Email visibility updated successfully' });
  } catch (err) {
    console.error('Error updating email visibility:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    await mssql.close();
  }
});

app.post('/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;
  console.log(usernameOrEmail)
  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('UsernameOrEmail', mssql.NVarChar(255), usernameOrEmail);
    request.input('Password', mssql.NVarChar(255), password);

    const result =  await request.execute('ValidateUserCredentials');

    if (result.returnValue === 0) {
      return res.status(401).json({ error: 'User not found' });
    } else if (result.returnValue === 1) {
      // Assuming the recordset contains the user information
      const userRecord = result.recordset;

      // Generate a token upon successful login
      const token = jwt.sign({ usernameOrEmail }, process.env.JWT_SECRET, {
        expiresIn: '1h', // Set the expiration time as needed
      });

      // Return the user record and token in the response
      return res.status(200).json({ user: userRecord, token });
    } else {
      return res.status(401).json({ error: 'Invalid password' });
    }
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    await mssql.close();
  }
});

// Stored procedure to get body of a mail
app.get('/getMailBody/:MailIdN/:UserID', async (req, res) => {
  const { MailIdN, UserID } = req.params;

  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('MailIdN', mssql.Int, MailIdN);
    request.input('UserID', mssql.Int, UserID);
    const result = await request.execute('GetMailBody');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching received emails:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    await mssql.close();
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});


