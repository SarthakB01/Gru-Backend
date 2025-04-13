// src/models/userModel.ts
interface IUser {
    username: string;
    password: string;
  }
  
  const users: IUser[] = [];
  
  export const findUserByUsername = (username: string): IUser | undefined => {
    return users.find(user => user.username === username);
  };
  
  export const addUser = (user: IUser): void => {
    users.push(user);
  };
  