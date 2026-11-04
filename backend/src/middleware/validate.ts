import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../utils/errors.js';

type Schemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validated: NonNullable<Request['validated']> = {};
      if (schemas.body) {
        validated.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        validated.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        validated.params = schemas.params.parse(req.params);
      }
      req.validated = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getValidatedBody<T>(req: Request): T {
  if (!req.validated?.body) {
    throw new AppError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Validated body missing.',
    });
  }
  return req.validated.body as T;
}

export function getValidatedQuery<T>(req: Request): T {
  if (!req.validated?.query) {
    throw new AppError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Validated query missing.',
    });
  }
  return req.validated.query as T;
}

export function getValidatedParams<T>(req: Request): T {
  if (!req.validated?.params) {
    throw new AppError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Validated params missing.',
    });
  }
  return req.validated.params as T;
}
