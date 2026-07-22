import { Image } from "react-native";

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <Image accessibilityLabel="Vercent ERP" source={require("../../assets/brand-logo.png")} resizeMode="contain" style={{ width: size, height: size }} />
  );
}
