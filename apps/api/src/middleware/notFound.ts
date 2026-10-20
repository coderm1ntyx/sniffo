import type { RequestHandler } from 'express';
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} was not found`,
    },
  });
};
