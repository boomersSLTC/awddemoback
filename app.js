const express = require('express');
const mssql = require('mssql');
const cors = require('cors');
const nodemailer = require("nodemailer");
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Database configuration

const config = {
    server: 'plesk4500.is.cc',
    database: 'anzeewdn_Mobile',
    user: 'anzeewdn_MobileAdmin',
    password: 'R^0c36l5f',
    options: {
        trustServerCertificate: true,
        trustedconnection:  true,
        enableArithAbort:  true,
    },
};

const transporter = nodemailer.createTransport({
  host: "mail.anzeewd.com",
  port: 8889,
  secure: false,
  auth: {
    user: "anzee.donotreply1@anzeewd.com",
    pass: "a@$doNotRp13",
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
  const { to_id, to_email, from_id, from_email, subject, body } = req.body;

  try {
      await connectToDatabase();
      const request = new mssql.Request();
      request.input('FromUserIdN', mssql.NVarChar(255), from_id);
      request.input('ToUserIdN', mssql.NVarChar(255), to_id);
      request.input('Subject', mssql.NVarChar(255), subject);
      request.input('Body', mssql.NVarChar(mssql.MAX), body);

      // Call the stored procedure to compose and save the email
      await request.execute('ComposeAndSendMail');
      if (to_email) {
        // Send the email only if to_email is provided
        await transporter.sendMail({
          from: 'anzee.donotreply1@anzeewd.com',
          to: to_email,
          subject: subject,
          text: body,
          html: `<b>${body}</b>`,
        });
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

// Stored procedure to get body of a mail
app.get('/getMailBody/:MailIdN', async (req, res) => {
  const { MailIdN } = req.params;

  try {
    await connectToDatabase();
    const request = new mssql.Request();
    request.input('MailIdN', mssql.Int, MailIdN);
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
