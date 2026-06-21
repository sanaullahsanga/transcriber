import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from "sequelize";
import { sequelize } from "../db";

export type AnalysisStatus = "pending" | "processing" | "completed" | "failed";

export type SttIssueSeverity = "low" | "medium" | "high";

export type SttIssueCategory =
  | "mishearing"
  | "proper_noun"
  | "diarization"
  | "punctuation"
  | "omission"
  | "hallucination"
  | "accent_clarity"
  | "background_noise"
  | "formatting"
  | "domain_term"
  | "other";

export type SttIssue = {
  category: SttIssueCategory;
  severity: SttIssueSeverity;
  excerpt: string;
  description: string;
  suggestion?: string;
};

export class SttAnalysis extends Model<
  InferAttributes<SttAnalysis>,
  InferCreationAttributes<SttAnalysis>
> {
  declare id: CreationOptional<string>;
  declare jobId: string;
  declare status: CreationOptional<AnalysisStatus>;
  declare summary: string | null;
  declare qualityScore: number | null;
  declare issues: CreationOptional<SttIssue[]>;
  declare llmModel: string | null;
  declare errorMessage: string | null;
  declare processingMs: number | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

SttAnalysis.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    jobId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.ENUM("pending", "processing", "completed", "failed"),
      allowNull: false,
      defaultValue: "pending",
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    qualityScore: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    issues: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    llmModel: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    processingMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: "stt_analyses",
    indexes: [{ fields: ["status"] }, { fields: ["createdAt"] }],
  },
);
