const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

const emailEnabled = Boolean(
  process.env.EMAIL_USER &&
  process.env.CLIENT_ID &&
  process.env.CLIENT_SECRET &&
  process.env.REFRESH_TOKEN,
);

let transporter = null;

if (emailEnabled) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: process.env.EMAIL_USER,
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      refreshToken: process.env.REFRESH_TOKEN,
    },
  });

  transporter.verify((error) => {
    if (error) {
      logger.error({ err: error }, "email transporter failed to verify");
    } else {
      logger.info("email server is ready to send messages");
    }
  });
} else {
  logger.warn(
    "email credentials not configured - emails will be skipped (see .env.example)",
  );
}

async function sendEmail(to, subject, text, html) {
  if (!emailEnabled) {
    logger.debug({ to, subject }, "email skipped (not configured)");
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"Backend Ledger" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });
    logger.info({ messageId: info.messageId }, "email sent");
  } catch (error) {
    logger.error({ err: error, to }, "error sending email");
  }
}

async function sendRegistrationEmail(userEmail, name) {
  const subject = "Welcome to Backend Ledger!";
  const text = `Hello ${name},\n\nThank you for registering at Backend Ledger. We're excited to have you on board!\n\nBest regards,\nThe Backend Ledger Team`;
  const html = `<p>Hello ${name},</p><p>Thank you for registering at Backend Ledger. We're excited to have you on board!</p><p>Best regards,<br>The Backend Ledger Team</p>`;
  await sendEmail(userEmail, subject, text, html);
}

async function sendLoginAlertEmail(userEmail, name) {
  const subject = "New sign-in to your account";
  const when = new Date().toUTCString();
  const text = `Hello ${name},\n\nWe noticed a new sign-in to your Backend Ledger account at ${when}.\n\nIf this wasn't you, please secure your account immediately.\n\nBest regards,\nThe Backend Ledger Team`;
  const html = `<p>Hello ${name},</p><p>We noticed a new sign-in to your Backend Ledger account at ${when}.</p><p>If this wasn't you, please secure your account immediately.</p><p>Best regards,<br>The Backend Ledger Team</p>`;
  await sendEmail(userEmail, subject, text, html);
}

async function sendTransactionEmail(userEmail, name, amount, toAccount) {
  const subject = "Transaction Successful!";
  const text = `Hello ${name},\n\nYour transaction of $${amount} to account ${toAccount} was successful.\n\nBest regards,\nThe Backend Ledger Team`;
  const html = `<p>Hello ${name},</p><p>Your transaction of $${amount} to account ${toAccount} was successful.</p><p>Best regards,<br>The Backend Ledger Team</p>`;
  await sendEmail(userEmail, subject, text, html);
}

async function sendTransactionFailureEmail(userEmail, name, amount, toAccount) {
  const subject = "Transaction Failed";
  const text = `Hello ${name},\n\nWe regret to inform you that your transaction of $${amount} to account ${toAccount} has failed. Please try again later.\n\nBest regards,\nThe Backend Ledger Team`;
  const html = `<p>Hello ${name},</p><p>We regret to inform you that your transaction of $${amount} to account ${toAccount} has failed. Please try again later.</p><p>Best regards,<br>The Backend Ledger Team</p>`;
  await sendEmail(userEmail, subject, text, html);
}

module.exports = {
  sendRegistrationEmail,
  sendLoginAlertEmail,
  sendTransactionEmail,
  sendTransactionFailureEmail,
};
