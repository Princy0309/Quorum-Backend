export interface AccessTokenPayload {
  id: string;
  type: 'access';
  sid: string;
  jti: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export interface RefreshTokenPayload {
  id: string;
  type: 'refresh';
  jti: string;
  rem?: boolean;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}
