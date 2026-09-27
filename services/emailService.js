const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const sendOTPEmail = async (to, otp, purpose = 'verification') => {
    let subject = 'Verify Your Email - Quorum';
    let message = 'Your email verification code is : ';

    if(purpose === 'reset'){
        subject = 'Password reset code - Quorum';
        message = 'Your password reset code is: ';
    }


const html = `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 450px;">
      <h2 style="color: #333;">Quorum</h2>
      <p>${message}</p>
      <div style="font-size: 28px; font-weight: bold; letter-spacing: 5px; color: #4F46E5; margin: 20px 0;">
        ${otp}
      </div>
      <p style="color: #777; font-size: 12px;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
    </div>
  `;

  const mailOptions = {
    from: `"Quorum" <${process.env.SMTP_USER}>`,
    to: to,
    subject: subject,
    html: html,
  };

  return await transporter.sendMail(mailOptions);
};

module.exports = {
    transporter,
    sendOTPEmail
};