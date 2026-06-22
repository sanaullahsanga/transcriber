import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from "sequelize";
import { sequelize } from "../db";

export type ReviewStatus = "draft" | "finalized";

export class CallReview extends Model<
  InferAttributes<CallReview>,
  InferCreationAttributes<CallReview>
> {
  declare id: CreationOptional<string>;
  declare benchmarkRunId: string | null;
  declare transcriptionJobId: string | null;
  declare originalFilename: string;
  declare referenceTranscript: string;
  declare referenceSourceJobId: string | null;
  declare referenceSourceProvider: string | null;
  declare status: CreationOptional<ReviewStatus>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

CallReview.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    benchmarkRunId: {
      type: DataTypes.UUID,
      allowNull: true,
      unique: true,
    },
    transcriptionJobId: {
      type: DataTypes.UUID,
      allowNull: true,
      unique: true,
    },
    originalFilename: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    referenceTranscript: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    referenceSourceJobId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    referenceSourceProvider: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("draft", "finalized"),
      allowNull: false,
      defaultValue: "draft",
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: "call_reviews",
    indexes: [{ fields: ["status"] }, { fields: ["createdAt"] }],
  },
);
