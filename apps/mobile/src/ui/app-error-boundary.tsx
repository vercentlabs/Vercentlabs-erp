import { Component, type ErrorInfo, type PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";

export class AppErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { if (__DEV__) console.error("Mobile render failure", error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <View accessibilityRole="alert" style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32, backgroundColor: "#F4F6FA", gap: 16 }}><Text style={{ fontSize: 24, fontWeight: "700", color: "#101828" }}>Let’s get you back to work</Text><Text style={{ fontSize: 16, lineHeight: 24, textAlign: "center", color: "#667085" }}>The workspace hit an unexpected problem. Your encrypted offline data is safe.</Text><Pressable accessibilityRole="button" onPress={() => this.setState({ failed: false })} style={{ minHeight: 52, justifyContent: "center", paddingHorizontal: 24, borderRadius: 999, backgroundColor: "#4F46E5" }}><Text style={{ color: "white", fontWeight: "600" }}>Try again</Text></Pressable></View>;
  }
}
