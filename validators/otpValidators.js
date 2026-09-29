const Joi = require('joi')

const verifyEmailSchema = Joi.object({
    otp : Joi.string().length(6).pattern(/^\S+$/, 'no spaces allowed').required(),
});

const sendResetSchema = Joi.object({
    email : Joi.string().email().max(255).pattern(/^\S+$/, 'no spaces allowed').required(),
})

const resetPasswordSchema = Joi.object({
    email: Joi.string().email().max(255).pattern(/^\S+$/, 'no spaces allowed').required(),
    otp: Joi.string().length(6).pattern(/^\S+$/, 'no spaces allowed').required(),
    newPassword: Joi.string().min(8).max(100).pattern(/^\S+$/, 'no spaces allowed').required(),
});

module.exports = {
    verifyEmailSchema,
    sendResetSchema,
    resetPasswordSchema,

}