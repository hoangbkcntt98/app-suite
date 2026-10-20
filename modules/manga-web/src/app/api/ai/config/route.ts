import {
  getDefaultImageAiSelection,
  getImageAiModelOptions,
} from "@manga/lib/aiModels";

export async function GET() {
  return Response.json({
    defaultSelection: getDefaultImageAiSelection(),
    models: getImageAiModelOptions(),
  });
}
