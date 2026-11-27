// Deep imports of react-native-android-widget used by test/widget-render.test.ts (the package index needs the native module).
declare module "react-native-android-widget/lib/module/widgets/FlexWidget.js";
declare module "react-native-android-widget/lib/module/widgets/ListWidget.js";
declare module "react-native-android-widget/lib/module/widgets/SvgWidget.js";
declare module "react-native-android-widget/lib/module/widgets/TextWidget.js";
declare module "react-native-android-widget/lib/module/api/build-widget-tree.js" {
  export function buildWidgetTree(jsx: unknown): unknown;
}
