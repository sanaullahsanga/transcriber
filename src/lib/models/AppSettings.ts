import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from "sequelize";
import { sequelize } from "../db";

export class AppSettings extends Model<
  InferAttributes<AppSettings>,
  InferCreationAttributes<AppSettings>
> {
  declare id: CreationOptional<number>;
  declare defaultProvider: string;
  declare defaultModel: string;
  declare normalizeAudio: boolean;
  declare speakerDiarization: boolean;
  declare keyterms: string[];
  declare language: string;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

AppSettings.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    defaultProvider: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "soniox",
    },
    defaultModel: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "stt-async-v5",
    },
    normalizeAudio: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    speakerDiarization: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    keyterms: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    language: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "en",
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: "app_settings",
  },
);
