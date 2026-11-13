import { PRODUCT_NAME, t } from "../i18n";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, TextInput, View, type TextInputProps } from "react-native";
import { useData } from "../state/Data";
import { useTheme } from "../theme/ThemeProvider";
import { FONT, RADIUS } from "../theme/tokens";
import { useChrome } from "../ui/Chrome";
import { Icon } from "../ui/Icon";
import { Btn, Eyebrow, Help, ring, T } from "../ui/primitives";

/*
 * Sign-in with the Kortex account (the same email / password as the web app). Accounts that are
 * not on the allowlist get "Kein Zugang". "Demo ansehen" keeps the prototype's sample data.
 */

export function Login() {
  const th = useTheme();
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
      placeholderTextColor={th.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      editable={!busy}
      {...props}
      style={[
        { height: 48, paddingHorizontal: 14, borderRadius: RADIUS.control, backgroundColor: th.bgSurfaceFlat, fontFamily: FONT.sans400, fontSize: 15, color: th.textPrimary },
        ring(th.borderSubtle),
        Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null,
      ]}
    />
  );

  if (!d.server) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: th.bgMainWindow }}>
        <View style={{ flex: 1, paddingTop: top + 56, paddingHorizontal: 24, gap: 14 }}>
          <View style={{ gap: 4, marginBottom: 10 }}>
            <Eyebrow>{PRODUCT_NAME}</Eyebrow>
            <T type="h1">{t("Connect server")}</T>
            <Help>{t("The address of your Kortex, for example kortex.example.com. The app only talks to this server.")}</Help>
          </View>
          {field({ placeholder: "kortex.example.com", value: address, onChangeText: setAddress, keyboardType: "url", autoComplete: "off", textContentType: "URL", accessibilityLabel: t("Server address"), onSubmitEditing: connect, returnKeyType: "go" })}
          {error && (
            <T size={13} lh={19} color={th.statusUrgentText}>
              {error}
            </T>
          )}
          <Btn variant="primary" block minHeight={48} onPress={connect}>
            {busy ? <ActivityIndicator color={th.onAccentAi} /> : t("Connect")}
          </Btn>
          <Btn variant="ghost" block minHeight={44} onPress={d.useDemo}>
            {t("View demo")}
          </Btn>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: th.bgMainWindow }}>
      <View style={{ flex: 1, paddingTop: top + 56, paddingHorizontal: 24, gap: 14 }}>
        <View style={{ gap: 4, marginBottom: 10 }}>
          <Eyebrow>{PRODUCT_NAME}</Eyebrow>
          <T type="h1">{t("Sign in")}</T>
          <Help>{t("With your Kortex account from {server}.", { server: d.server.replace(/^https?:\/\//, "") })}</Help>
        </View>
        {d.auth === "noAccess" && (
          <View style={[{ flexDirection: "row", gap: 10, padding: 12, borderRadius: RADIUS.lg, backgroundColor: th.bgSurfaceFlat }, ring(th.borderSubtle)]}>
            <Icon name="x" size={16} color={th.statusUrgentText} />
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
        {error && d.auth !== "noAccess" && (
          <T size={13} lh={19} color={th.statusUrgentText}>
            {error}
          </T>
        )}
        <Btn variant="primary" block minHeight={48} onPress={submit}>
          {busy ? <ActivityIndicator color={th.onAccentAi} /> : t("Sign in")}
        </Btn>
        <Btn variant="ghost" block minHeight={44} onPress={d.useDemo}>
          {t("View demo")}
        </Btn>
      </View>
    </KeyboardAvoidingView>
  );
}
