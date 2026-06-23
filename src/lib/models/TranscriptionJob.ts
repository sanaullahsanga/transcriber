import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from "sequelize";
import { sequelize } from "../db";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export type JobOptions = {
  normalize: boolean;
  speakerDiarization: boolean;
  keyterms: string[];
  language: string;
  /** When true, this job is the automatic reference transcript (not a comparison slot). */
  isReference?: boolean;
};

export class TranscriptionJob extends Model<
  InferAttributes<TranscriptionJob>,
  InferCreationAttributes<TranscriptionJob>
> {
  declare id: CreationOptional<string>;
  declare originalFilename: string;
  declare storedPath: string;
  declare mimeType: string | null;
  declare fileSizeBytes: number;
  declare provider: string;
  declare model: string;
  declare status: CreationOptional<JobStatus>;
  declare transcript: string | null;
  declare errorMessage: string | null;
  declare options: JobOptions;
  declare durationMs: number | null;
  declare processingMs: number | null;
  declare benchmarkRunId: string | null;
  declare slotIndex: number | null;
  declare completedAt: Date | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

TranscriptionJob.init(
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
    provider: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    model: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "processing", "completed", "failed"),
      allowNull: false,
      defaultValue: "pending",
    },
    transcript: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    options: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {
        normalize: true,
        speakerDiarization: true,
        keyterms: [],
        language: "en",
      },
    },
    durationMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    processingMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    benchmarkRunId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    slotIndex: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: "transcription_jobs",
    indexes: [
      { fields: ["status"] },
      { fields: ["createdAt"] },
      { fields: ["benchmarkRunId"] },
    ],
  },
);
