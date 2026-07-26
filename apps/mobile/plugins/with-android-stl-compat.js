const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

const modernArgument = "-DCMAKE_ANDROID_STL_TYPE=c++_shared";
const packages = [
  {
    name: "expo-modules-core",
    resolveFrom: "expo",
    gradle: "build.gradle",
    syntax: "groovy",
    target: "expo-modules-core",
    linkScope: "PRIVATE",
  },
  { name: "expo-sqlite", gradle: "build.gradle", syntax: "groovy", target: "${PACKAGE_NAME}" },
  {
    name: "react-native-screens",
    gradle: "build.gradle",
    syntax: "groovy",
    target: "rnscreens",
  },
  {
    name: "react-native-gesture-handler",
    gradle: "build.gradle",
    syntax: "groovy",
    cmake: "src/main/jni/CMakeLists.txt",
    target: "${PACKAGE_NAME}",
  },
  {
    name: "react-native-reanimated",
    gradle: "build.gradle.kts",
    syntax: "kotlin",
    target: "reanimated",
  },
  {
    name: "react-native-worklets",
    gradle: "build.gradle.kts",
    syntax: "kotlin",
    target: "worklets",
  },
];

function patchDependency(projectRoot, dependency) {
  const resolvePaths = [projectRoot];
  if (dependency.resolveFrom) {
    const parentPackage = require.resolve(
      `${dependency.resolveFrom}/package.json`,
      { paths: resolvePaths },
    );
    resolvePaths.unshift(path.dirname(parentPackage));
  }
  const packageJson = require.resolve(`${dependency.name}/package.json`, {
    paths: resolvePaths,
  });
  const gradlePath = path.join(
    path.dirname(packageJson),
    "android",
    dependency.gradle,
  );
  const source = fs.readFileSync(gradlePath, "utf8");

  const cmakePath = path.join(
    path.dirname(packageJson),
    "android",
    dependency.cmake || "CMakeLists.txt",
  );
  const cmakeSource = fs.readFileSync(cmakePath, "utf8");
  const marker = "# Vercentlabs Android STL compatibility.";
  const linkLine = `target_link_libraries(${dependency.target}${dependency.linkScope ? ` ${dependency.linkScope}` : ""} c++_shared)`;
  const markerPattern = new RegExp(
    `${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\ntarget_link_libraries\\([^\\r\\n]+\\)`,
  );
  const cmakeOutput = cmakeSource.includes(marker)
    ? cmakeSource.replace(markerPattern, `${marker}\n${linkLine}`)
    : `${cmakeSource.trimEnd()}\n\n${marker}\n${linkLine}\n`;
  if (cmakeOutput !== cmakeSource) {
    fs.writeFileSync(cmakePath, cmakeOutput);
  }
  if (source.includes(modernArgument)) return;
  const legacy = '"-DANDROID_STL=c++_shared",';
  if (!source.includes(legacy)) {
    throw new Error(
      `${dependency.name} no longer exposes the expected Android STL argument.`,
    );
  }
  const replacement =
    dependency.syntax === "groovy"
      ? `${legacy}\n          "${modernArgument}",`
      : `${legacy}\n                    "${modernArgument}",`;
  fs.writeFileSync(gradlePath, source.replace(legacy, replacement));
}

function patchReactNativeAppRuntime(projectRoot) {
  const packageJson = require.resolve("react-native/package.json", {
    paths: [projectRoot],
  });
  const cmakePath = path.join(
    path.dirname(packageJson),
    "ReactAndroid",
    "cmake-utils",
    "default-app-setup",
    "CMakeLists.txt",
  );
  const source = fs.readFileSync(cmakePath, "utf8");
  const marker = "# Vercentlabs app and autolinked C++ runtime compatibility.";
  if (source.includes(marker)) return;
  const includeLine =
    "include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)";
  if (!source.includes(includeLine)) {
    throw new Error("React Native app CMake template no longer matches expectations.");
  }
  const runtimeLine =
    'set(CMAKE_CXX_STANDARD_LIBRARIES "${CMAKE_CXX_STANDARD_LIBRARIES} -lc++_shared")';
  fs.writeFileSync(cmakePath, source.replace(includeLine, `${marker}\n${runtimeLine}\n${includeLine}`));
}

module.exports = function withAndroidStlCompat(config) {
  return withDangerousMod(config, [
    "android",
    async (nextConfig) => {
      patchReactNativeAppRuntime(nextConfig.modRequest.projectRoot);
      for (const dependency of packages) {
        patchDependency(nextConfig.modRequest.projectRoot, dependency);
      }
      return nextConfig;
    },
  ]);
};
