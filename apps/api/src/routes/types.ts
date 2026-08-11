import type { ApiResult } from "@datafoundry/contracts";
import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type { FileAssetService } from "@datafoundry/files";
import type { LocalKnowledgeService } from "@datafoundry/knowledge";
import type { MetadataStore } from "@datafoundry/metadata";
import type { RunCancelRegistry } from "../run-cancel-registry.js";
import type { AuthService } from "../auth/service.js";
import type { PreschoolOverviewAiPageWorkflow } from "../energy/preschool-overview-ai-page-workflow.js";

export type ConfigApiContext = {
  authService: AuthService;
  dataGateway: LocalDataGateway;
  fileAssetService: FileAssetService;
  knowledgeService: LocalKnowledgeService;
  metadataStore: MetadataStore;
  overviewAiWorkflow: PreschoolOverviewAiPageWorkflow;
  runCancelRegistry: RunCancelRegistry;
  userId: string;
  workspaceId?: string;
};

export type ConfigApiResponse = {
  body: ApiResult<unknown> | Buffer | Record<string, unknown>;
  headers?: Record<string, string>;
  status: number;
};
