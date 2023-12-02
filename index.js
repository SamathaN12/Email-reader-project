//googleapis: This package is imported from the googleapis module
const { google } = require("googleapis");

/*
CLIENT_ID , CLEINT_SECRET and REDIRECT_URI obtained from the Google Cloud (https://console.developers.google.com) by setting up a project.
REFRESH_TOKEN is generated from the REDIRECT_URI by authorizing with scope as https://mail.google.com scope.
*/
const {
  CLIENT_ID,
  CLEINT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
} = require("./credentials");

//implemented the “Login with google” API here.
//basically OAuth2 module allow to retrive an access token, refresh it and retry the request.
const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLEINT_SECRET,
  REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

//repliedMailThreadsIds: To keep track of threads already been replied to in this session
const repliedMailThreadsIds = new Set();

//Step 1. check for new emails and sends replies .
async function checkEmailsAndSendReplies() {
  console.log('start');
  try {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    // The app should check for new emails in a given Gmail ID
    const res = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread",
    });

    //The app should send replies to Emails that have no prior replies
    const messages = res.data.messages?.filter((message) => !repliedMailThreadsIds.has(message.threadId) );
    
    if (messages && messages.length > 0) {

      //Fetch the Auto Reply Label 
      const labelName = "readLater";
      const labelId = await getLabelId(gmail, labelName);

      // To reply to each Thread
      for (const message of messages) {
        const threadId = message.threadId;

        // Fetch the complete Email data.
        const email = await gmail.users.messages.get({
          userId: "me",
          id: message.id,
        });

        console.log('\n##############################################################\n');
        console.log('email', email);
        console.log('Headers', email.data.payload.headers);
        console.log('\n##############################################################\n');
        // Extract the From, To and Subject from the email payload headers.

        const fromAddress = email.data.payload.headers.find(
          (header) => header.name === "From"
        );
        const toAddresses = email.data.payload.headers.find(
          (header) => header.name === "To"
        );
        const ccAddresses = email.data.payload.headers.find(
          (header) => header.name === "Cc"
        );
        const self = email.data.payload.headers.find(
          (header) => header.name === "Delivered-To"
        );
        const subject = email.data.payload.headers.find(
          (header) => header.name === "Subject"
        );

        //Sender Email Address
        const From = fromAddress.value;
        //Recepients Email Addresses ( Self and others if any)
        const ToEmail = toAddresses.value ?? '';
        //Recepients Email Addresses ( Self and others if any)
        const CcEmail = ccAddresses?.value ?? '';
        //Recepients Email Addresses ( Self )
        const Self = self.value;
        //Subject of Eemail
        const Subject = subject.value;

        let listToAddress = [...ToEmail.split(',').filter((email) => !email.includes(Self))];
        listToAddress.push(From);

        let listCcAddress = [...CcEmail.split(',').filter((email) => !email.includes(Self))].join(',');

        console.log('\n##############################################################\n');
        console.log("From Address", From);
        console.log("To Addresses", ToEmail);
        console.log('\n##############################################################\n');
        
        //check if the user already been replied to
        if (repliedMailThreadsIds.has(threadId)) {
          console.log("Already replied to Thread: ", threadId);
          repliedMailThreadsIds.add(threadId);
          continue;
        }
        // 2.send replies to Emails that have no prior replies
        // Check if the email has any replies.
        const thread = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
        });

        // identify and isolate the email threads in which no prior email has been sent by user
        const replies = thread.data.messages.filter((message) => message.labelIds.includes('SENT'));

        if (replies.length === 0) {
          // Reply to the email.
          await gmail.users.messages.send({
            auth: oAuth2Client,
            userId: "me",
            requestBody: {
              raw: await createReplyRaw(Self, listToAddress.join(','), listCcAddress, Subject),
              threadId: threadId
            },
          });

          // Add a label to the email.
          await gmail.users.messages.modify({
            userId: "me",
            id: message.id,
            requestBody: {
              addLabelIds: [labelId],
            },
          });

          console.log('\n##############################################################\n');
          console.log(`Reply Sent in thread ${threadId} to ${From}`);
          console.log('\n##############################################################\n');
          //Add the user to replied users set
          repliedMailThreadsIds.add(threadId);
        }
        else{
          console.log("Already replied to Thread sometime before: ", threadId);
        }
      }
    }
  } catch (error) {
    console.error("Error occurred:", error);
  }
}

//this function is basically converte string to base64EncodedEmail format
async function createReplyRaw(from, to, cc, subject) {
  let responseMessage = 'Hello world';
  const messages = [
    `From: ${from}`,
    `To: ${to}`,
    `cc: ${cc}`,
    `In-Reply-To: ${to}`,
    `Content-Type: text/html; charset=utf-8`,
    `MIME-Version: 1.0`,
    `Subject: ${subject}`,
    '',
    responseMessage,
    '',
  ];

  const message = messages.join('\n');
  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/=+$/, "")
    .replace(/\//g, "_");

  return encodedMessage;
}

//To get the required Label to add it to the email. The app should add a Label to the email and move the email to the label
async function getLabelId(gmail, labelName) {
  // Check if the label already exists.
  const labelsList = await gmail.users.labels.list({ userId: "me" });
  const labels = labelsList?.data?.labels;

  const existingLabel = labels?.find((label) => label.name === labelName);
  if (existingLabel) {
    return existingLabel.id;
  }

  // Create the label if it doesn't exist.
  const newLabel = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  return newLabel?.data?.id;
}

/*The app should repeat this sequence of steps 1-3 in random intervals of 45 to 120 seconds*/
function getRandomInterval(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

//Setting Interval and calling main function in every interval
setInterval(checkEmailsAndSendReplies, getRandomInterval(45,120)*1000);
//setInterval(checkEmailsAndSendReplies, 1000);

/*note on areas where your code can be improved.
  1.Error handling: The code currently logs any errors that occur during the execution but does not handle them in a more robust manner.
  2.Code efficiency: The code could be optimized to handle larger volumes of emails more efficiently.
  3.Security: Ensuring that sensitive information, such as client secrets and refresh tokens, are stored securely and not exposed in the code.
  4.User-specific configuration: Making the code more flexible by allowing users to provide their own configuration options, such as email filters or customized reply messages.
  These are some areas where the code can be improved, but overall, it provides implementation of auto-reply functionality using the Gmail API.
  5.Time Monitoring: The code currently use randominterval function to generate seconds and in this code can be improved by adding cron jobs package to schedule email tasks 
*/
