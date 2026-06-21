import { DataTypes } from "sequelize";
import { DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT } from "../llm/default-stt-prompt";
import { sequelize } from "../db";

async function tableExists(tableName: string): Promise<boolean> {
  const tables = (await sequelize.getQueryInterface().showAllTables()) as string[];
  return tables.includes(tableName);
}

export async function applySchemaPatches() {
  if (!(await tableExists("transcription_jobs"))) {
    return;
  }

  const qi = sequelize.getQueryInterface();
  const columns = await qi.describeTable("transcription_jobs");

  if (!columns.benchmarkRunId) {
    await qi.addColumn("transcription_jobs", "benchmarkRunId", {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }

  if (!columns.slotIndex) {
    await qi.addColumn("transcription_jobs", "slotIndex", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }

  if (!columns.processingMs) {
    await qi.addColumn("transcription_jobs", "processingMs", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }

  if (await tableExists("app_settings")) {
    const settingsColumns = await qi.describeTable("app_settings");
    if (!settingsColumns.sttAnalysisSystemPrompt) {
      await qi.addColumn("app_settings", "sttAnalysisSystemPrompt", {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: DEFAULT_STT_ANALYSIS_SYSTEM_PROMPT,
      });
    }
  }
}
