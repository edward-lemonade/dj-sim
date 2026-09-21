import API_ROUTES from '@/config/api';
import { axiosClient } from '@/lib/clients/axios';
import type { User } from '@/lib/types/User';

type CreateUserRequest = Pick<User, 
  'username'
> 

export async function registerUser(input: CreateUserRequest): Promise<User> {
  const { data } = await axiosClient.post<User>(API_ROUTES.user.register, input);
  return data;
}

export async function getCurrentUser(): Promise<User | null> {
  const { data } = await axiosClient.get<User | null>(API_ROUTES.user.me);
  return data;
}
