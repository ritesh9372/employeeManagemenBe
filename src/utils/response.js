export const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data });
};

export const errorResponse = (res, message = 'An error occurred', statusCode = 500) => {
  return res.status(statusCode).json({ success: false, message });
};

export const paginatedResponse = (res, data, pagination, message = 'Success') => {
  return res.status(200).json({ success: true, message, data, pagination });
};
