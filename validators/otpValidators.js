const Joi = require('joi')

const verifyEmailSchema = Joi.object({
    otp : Joi.string().length(6).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required(),
    email: Joi.string().email().optional()
});

const sendResetSchema = Joi.object({
    email : Joi.string().email().max(50).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required(),
})

const resetPasswordSchema = Joi.object({
    email: Joi.string().email().max(50).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required(),
    otp: Joi.string().length(6).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required(),
    newPassword: Joi.string().min(8).max(30).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required(),
});

module.exports = {
    verifyEmailSchema,
    sendResetSchema,
    resetPasswordSchema,

}