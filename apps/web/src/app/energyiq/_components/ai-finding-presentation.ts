import {
  filterAiFindingPresentationEvidence,
  parseAiFindingPresentation,
  type AiFindingPresentation,
  type AiPresentationBlock,
  type AiPresentationValueItem,
} from "@datafoundry/contracts";

export {
  filterAiFindingPresentationEvidence,
  parseAiFindingPresentation,
  type AiFindingPresentation,
  type AiPresentationBlock,
  type AiPresentationValueItem,
};

export const AI_FINDING_PRESENTATION_PROMPT = [
  "For each Finding, use presentation v1 blocks only when clearer; there is no presentation-block quota or executable HTML/JS/CSS/React.",
  "Each quantitative block must cite a subset of that Finding's sources in evidenceRefs and/or evidenceSqlIndexes. Preserve the cited metric, label, unit and business meaning.",
  "Blocks: metric {type,label,value,unit?,context?}; comparison/ranking/share/distribution {type,title?,unit?,items:[{label,value}]}; trend {type,title?,unit?,points:[{label,value}]}; heatmap {type,title?,unit?,xLabels,yLabels,values}; table {type,title?,columns,rows}; callout {type,tone,text}. Add evidenceRefs/evidenceSqlIndexes to every quantitative block.",
].join("\n");

export function aiFindingPresentationEvidenceText(presentation: AiFindingPresentation | null | undefined): string {
  if (!presentation) return "";
  return presentation.blocks.flatMap((block) => {
    switch (block.type) {
      case "metric":
        return [block.label, block.value, block.unit, block.context];
      case "comparison":
      case "ranking":
      case "share":
      case "distribution":
        return [block.title, block.unit, ...block.items.flatMap((item) => [item.label, item.value])];
      case "trend":
        return [block.title, block.unit, ...block.points.flatMap((point) => [point.label, point.value])];
      case "heatmap":
        return [block.title, block.unit, ...block.xLabels, ...block.yLabels, ...block.values.flat()];
      case "table":
        return [block.title, ...block.columns, ...block.rows.flat()];
      case "callout":
        return [block.text];
    }
  }).filter((part): part is string | number => typeof part === "number" || Boolean(part)).join(" ");
}
