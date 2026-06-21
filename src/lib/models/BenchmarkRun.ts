import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from "sequelize";
import { sequelize } from "../db";
import type { JobOptions } from "./TranscriptionJob";

export type BenchmarkSlotConfig = {
  provider: string;
  model: string;
  label?: string;
};

export class BenchmarkRun extends Model<
  InferAttributes<BenchmarkRun>,
  InferCreationAttributes<BenchmarkRun>
> {
  declare id: CreationOptional<string>;
  declare originalFilename: string;
  declare storedPath: string;
  declare mimeType: string | null;
  declare fileSizeBytes: number;
  declare options: JobOptions;
  declare slots: BenchmarkSlotConfig[];
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

BenchmarkRun.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    originalFilename: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    storedPath: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    mimeType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    fileSizeBytes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    options: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    slots: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: "benchmark_runs",
    indexes: [{ fields: ["createdAt"] }],
  },
);
