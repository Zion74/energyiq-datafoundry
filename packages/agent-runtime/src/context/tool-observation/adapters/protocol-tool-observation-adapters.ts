import { asRecord, BaseToolObservationAdapter, pickFields } from "./base-tool-observation-adapter.js";

/**
 * analysis_requirements_commit is a protocol-runtime action, not an external
 * data source. Its result is already validated by the ActionRouter; this
 * adapter gives the model a small, explicit acknowledgement instead of the
 * generic CONTEXT_ADAPTER_REQUIRED fallback.
 */
export class AnalysisRequirementsCommitToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "analysis_requirements_commit";
  readonly resultType = "analysis-requirements-commit";

  protected project(raw: unknown): unknown {
    const record = asRecord(raw);
    if (record.ok === false || record.isError === true) {
      return {
        committed: false,
        ...pickFields(record, ["ok", "isError", "error", "recovery"]),
        source: "analysis-protocol",
      };
    }
    return {
      committed: true,
      ...pickFields(record, ["claims"]),
      source: "analysis-protocol",
    };
  }
}
