import { Text, View } from "react-native";

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <View
      accessibilityLabel="Vercentlabs ERP"
      accessible
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: size * 0.3,
        backgroundColor: "#4F46E5",
        shadowColor: "#4F46E5",
        shadowOffset: { width: 0, height: Math.max(4, size * 0.2) },
        shadowOpacity: 0.2,
        shadowRadius: Math.max(8, size * 0.45),
        elevation: 5,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: size * 0.58,
          height: size * 0.58,
          borderTopRightRadius: size * 0.3,
          borderBottomLeftRadius: size * 0.58,
          backgroundColor: "rgba(255,255,255,0.10)",
        }}
      />
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: size * 0.43,
          fontWeight: "900",
          letterSpacing: -size * 0.018,
        }}
      >
        V
      </Text>
    </View>
  );
}
