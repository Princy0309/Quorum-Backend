const crypto = require('crypto');

const hashtokens = (tokens) => {
    return crypto.createHash('sha256').update(token).digest('hex');
};

module.exports = hashtokens;