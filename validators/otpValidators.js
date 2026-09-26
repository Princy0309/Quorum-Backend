const Joi = require('joi')

const verifyEmailSchema = Joi.object({
    otp : Joi.string().length(6).required(),
});

const sendResetSchema = Joi.object({
    email : Joi.string().email().required(),
})

const resetPasswordSchema = Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string().length(6).required(),
    newPassword: Joi.string().min(8).required(),
});

module.exports = {
    verifyEmailSchema,
    sendResetSchema,
    resetPasswordSchema,

}