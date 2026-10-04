export interface User {
  id: string;
  clerkId: string | null;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicUser = Pick<User,
  'id' |
  'clerkId' |
  'username' |
  'createdAt' |
  'updatedAt'
>
