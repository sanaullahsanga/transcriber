import { Sequelize } from "sequelize";

const globalForDb = globalThis as unknown as {
  sequelize?: Sequelize;
};

function createSequelize() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  return new Sequelize(url, {
    dialect: "postgres",
    logging: process.env.NODE_ENV === "development" ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  });
}

export const sequelize = globalForDb.sequelize ?? createSequelize();

if (process.env.NODE_ENV !== "production") {
  globalForDb.sequelize = sequelize;
}
