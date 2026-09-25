const crypto = require('crypto');
const { hashToken } = require('./hashToken');

const generateOTP = () => {
  const code = crypto.randomInt(100000, 1000000).toString();
  return {
    code,
    codeHash: hashToken(code)
  };
};

module.exports = { generateOTP };
