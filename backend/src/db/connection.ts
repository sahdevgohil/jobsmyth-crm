import mongoose from 'mongoose';
import { getEnv } from '../config/env.js';

export async function connectMongo(): Promise<typeof mongoose> {
  const uri = getEnv().MONGODB_URI;
  mongoose.set('strictQuery', true);
  return mongoose.connect(uri);
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
