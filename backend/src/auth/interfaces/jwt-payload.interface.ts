import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  tokenVersion: number;
}

export interface JwtUser {
  userId: string;
  username: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user: JwtUser;
}
