import { collections } from '../../db/collections';
import type { UserDocument } from '../../db/types/User';
import type { Filter, FindOptions, InsertOneResult, UpdateResult, OptionalId } from 'mongodb';

export const UsersService = {
  async hashPassword(password: string): Promise<string> {
    return Bun.password.hash(password, { algorithm: "bcrypt", cost: 12 });
  },

  async verifyPassword(user: UserDocument, candidate: string): Promise<boolean> {
    if (!user.password) return false;
    // Handle both legacy bcryptjs hashes and new Bun bcrypt hashes
    return Bun.password.verify(candidate, user.password);
  },

  async insertOne(doc: OptionalId<UserDocument>): Promise<InsertOneResult<UserDocument>> {
    if (doc.password) {
      doc.password = await this.hashPassword(doc.password);
    }
    return collections.users().insertOne(doc as UserDocument);
  },

  async updateOne(filter: Filter<UserDocument>, update: any): Promise<UpdateResult<UserDocument>> {
    if (update.$set && update.$set.password) {
      update.$set.password = await this.hashPassword(update.$set.password);
    }
    return collections.users().updateOne(filter, update);
  },

  async findOne(
    filter: Filter<UserDocument>, 
    options?: FindOptions<UserDocument>, 
    includePassword = false
  ): Promise<UserDocument | null> {
    const projection = options?.projection || {};
    if (!includePassword) {
      Object.assign(projection, { password: 0, passwordResetOtpHash: 0, passwordResetTokenHash: 0 });
    }
    return collections.users().findOne(filter, { ...options, projection });
  },

  async find(
    filter: Filter<UserDocument>, 
    options?: FindOptions<UserDocument>, 
    includePassword = false
  ): Promise<UserDocument[]> {
    const projection = options?.projection || {};
    if (!includePassword) {
      Object.assign(projection, { password: 0, passwordResetOtpHash: 0, passwordResetTokenHash: 0 });
    }
    return collections.users().find(filter, { ...options, projection }).toArray();
  }
};
