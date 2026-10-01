const sendSuccess = (res, statusCode, message, data = null) => {
  const response = { success: true, statusCode, message };
  if (data) response.data = data;
  return res.status(statusCode).json(response);
};

const sendError = (res, statusCode, message) => {
  return res.status(statusCode).json({ success: false, statusCode, message });
};

module.exports = { sendSuccess, sendError };
module.exports.default = { sendSuccess, sendError };
