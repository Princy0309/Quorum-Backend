const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.message, err.stack);

  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational === true;

  res.status(statusCode).json({
    success: false,
    message: isOperational || statusCode < 500
      ? err.message
      : 'Internal Server Error',
  });
};

module.exports = errorHandler;
