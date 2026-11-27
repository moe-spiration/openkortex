import { PRODUCT_NAME, t } from "../i18n";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, TextInput, View, type TextInputProps } from "react-native";
import { useData } from "../state/Data";
import { useRuhe, useTheme } from "../theme/ThemeProvider";
import { FONT, RADIUS } from "../theme/tokens";
import { useChrome } from "../ui/Chrome";
import { Icon } from "../ui/Icon";
import { Btn, Eyebrow, Help, ring, T } from "../ui/primitives";
import { RButton, RText } from "../ui/ruhe";

/*
 * Sign-in with the Kortex account (the same email / password as the web app). Accounts that are
 * not on the allowlist get "Kein Zugang". "Demo ansehen" keeps the prototype's sample data.
 */

export function Login() {
  const th = useTheme();
  // Ruhe (android-richtlinien.md 11, 12): eyebrow + title 30/700, fields lum2 (dark) / lum1 + ring (light) r12,
  // one primary button (44, r12) and the demo as ghost; errors in crit. Same flow as vivid.
  const ruhe = useRuhe();
  const dark = th.name === "dark";
  const { top } = useChrome();
  const d = useData();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // First start of a build without a server: ask for the address of the user's Kortex.
  const connect = async () => {
    if (!address.trim()) return setError(t("Enter the address of your Kortex server"));
    setBusy(true);
    setError(null);
    const err = await d.connectServer(address);
    setBusy(false);
    if (err) setError(err);
  };

  const submit = async () => {
    if (!email.trim() || !password) return setError(t("Enter email and password"));
    setBusy(true);
    setError(null);
    const err = await d.signIn(email, password);
    setBusy(false);
    if (err) setError(err);
  };

  const field = (props: TextInputProps) => (
    <TextInput
      placeholderTextColor={ruhe ? th.t4 : th.textMuted}
      selectionColor={ruhe ? th.accent : undefined}
      autoCapitalize="none"
      autoCorrect={false}
      editable={!busy}
      {...props}
      style={[
        ruhe
          ? { height: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: dark ? th.lum2 : th.lum1, fontFamily: FONT.sans400, fontSize: 15, color: th.t1 }
          : { height: 48, paddingHorizontal: 14, borderRadius: RADIUS.control, backgroundColor: th.bgSurfaceFlat, fontFamily: FONT.sans400, fontSize: 15, color: th.textPrimary },
        ruhe ? (dark ? null : ring(th.hairStrong)) : ring(th.borderSubtle),
        Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null,
      ]}
    />
  );

  const head = (title: string, help: string) =>
    ruhe ? (
      <View style={{ gap: 4, marginBottom: 14 }}>
        <RText step="eyebrow" color={th.t3}>
          {PRODUCT_NAME}
        </RText>
        <RText step="title" accessibilityRole="header">
          {title}
        </RText>
        <RText step="rowSub" color={th.t3} style={{ marginTop: 4 }}>
          {help}
        </RText>
      </View>
    ) : (
      <View style={{ gap: 4, marginBottom: 10 }}>
        <Eyebrow>{PRODUCT_NAME}</Eyebrow>
        <T type="h1">{title}</T>
        <Help>{help}</Help>
      </View>
    );
  const errorLine = (text: string) => (
    <T size={13} lh={19} color={ruhe ? th.crit : th.statusUrgentText}>
      {text}
    </T>
  );
  const buttons = (label: string, run: () => void) =>
    ruhe ? (
      <View style={{ gap: 8, marginTop: 4 }}>
        <View style={{ flexDirection: "row" }}>
          <RButton variant="primary" grow label={label} disabled={busy} onPress={run} />
        </View>
        {busy && <ActivityIndicator color={th.t3} />}
        <RButton variant="ghost" label={t("View demo")} onPress={d.useDemo} />
      </View>
    ) : (
      <>
        <Btn variant="primary" block minHeight={48} onPress={run}>
          {busy ? <ActivityIndicator color={th.onAccentAi} /> : label}
        </Btn>
        <Btn variant="ghost" block minHeight={44} onPress={d.useDemo}>
          {t("View demo")}
        </Btn>
      </>
    );

  if (!d.server) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: th.bgMainWindow }}>
        <View style={{ flex: 1, paddingTop: top + 56, paddingHorizontal: ruhe ? 20 : 24, gap: ruhe ? 10 : 14 }}>
          {head(t("Connect server"), t("The address of your Kortex, for example kortex.example.com. The app only talks to this server."))}
          {field({ placeholder: "kortex.example.com", value: address, onChangeText: setAddress, keyboardType: "url", autoComplete: "off", textContentType: "URL", accessibilityLabel: t("Server address"), onSubmitEditing: connect, returnKeyType: "go" })}
          {error && errorLine(error)}
          {buttons(t("Connect"), () => void connect())}
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: th.bgMainWindow }}>
      <View style={{ flex: 1, paddingTop: top + 56, paddingHorizontal: ruhe ? 20 : 24, gap: ruhe ? 10 : 14 }}>
        {head(t("Sign in"), t("With your Kortex account from {server}.", { server: d.server.replace(/^https?:\/\//, "") }))}
        {d.auth === "noAccess" && (
          <View style={[{ flexDirection: "row", gap: 10, padding: 12, borderRadius: ruhe ? 16 : RADIUS.lg, backgroundColor: ruhe ? "transparent" : th.bgSurfaceFlat }, ring(ruhe ? th.hairStrong : th.borderSubtle)]}>
            <Icon name="x" size={16} color={ruhe ? th.crit : th.statusUrgentText} />
            <View style={{ flex: 1, gap: 2 }}>
              <T size={14} lh={20} weight={600}>
                {t("No access")}
              </T>
              <Help>{t("This account is not enabled for Kortex. Ask the operator for an invitation.")}</Help>
            </View>
          </View>
        )}
        {field({ placeholder: t("Email"), value: email, onChangeText: setEmail, keyboardType: "email-address", autoComplete: "email", textContentType: "emailAddress", accessibilityLabel: t("Email") })}
        {field({ placeholder: t("Password"), value: password, onChangeText: setPassword, secureTextEntry: true, autoComplete: "password", textContentType: "password", accessibilityLabel: t("Password"), onSubmitEditing: submit, returnKeyType: "go" })}
        {error && d.auth !== "noAccess" && errorLine(error)}
        {buttons(t("Sign in"), () => void submit())}
      </View>
    </KeyboardAvoidingView>
  );
}
