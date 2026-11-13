import { Editor } from "../src/screens/Editor";
import { Toast } from "../src/ui/Shell";

/** /editor?id=<item> edits an item, /editor creates a note. */
export default function EditorRoute() {
  return (
    <>
      <Editor />
      <Toast />
    </>
  );
}
