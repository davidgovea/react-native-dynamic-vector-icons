import fs from "fs";
import path from "path";
import * as recast from "recast";
import * as TypeScriptParser from "recast/parsers/typescript";

const {
  types: { builders: b, namedTypes: n },
} = recast;

// Set up project & vector-icons directories
const parentDir = path.resolve(__dirname, "..");
const isDev = !parentDir.endsWith("dist");
const projectDir = isDev ? parentDir : path.resolve(__dirname, "../..");
const builtLibPath = path.resolve(projectDir, "dist", "lib");
const isInstalledAsDependency = path
  .resolve(projectDir, "..")
  .endsWith("node_modules");
const vectorIconsPath = isInstalledAsDependency
  ? path.resolve(projectDir, "../node_modules/react-native-vector-icons")
  : path.resolve(projectDir, "node_modules/react-native-vector-icons");
const glyphmapsPath = path.join(vectorIconsPath, "glyphmaps");

// Parse Icon.d.ts file into AST
const typeFilePath = path.join(builtLibPath, "Icon.d.ts");
const typeFileContents = fs.readFileSync(typeFilePath).toString();
const typeFileAst = recast.parse(typeFileContents, {
  parser: TypeScriptParser,
});

// We will modify top-level Interface Declarations. Filter & type for ease of use
const interfaces: Array<recast.types.namedTypes.TSInterfaceDeclaration> = typeFileAst.program.body.filter(
  (node: any) => n.TSInterfaceDeclaration.check(node),
);
// Function to find the desired Interface Declaration
const findFontPropInterface = (fontName: string) => {
  return interfaces.find((i) => {
    if (n.Identifier.check(i.id)) {
      return i.id.name === `${fontName}Props`;
    }
  });
};

const addGlyphNames = (glyphmapFile, fontName) => {
  // Load glyphmap
  const glyphmapContents = require(path.join(glyphmapsPath, glyphmapFile));
  // Build Union type from glyphmap keys
  const names = b.tsPropertySignature(
    b.identifier("name"),
    b.tsTypeAnnotation(
      b.tsUnionType(
        Object.keys(glyphmapContents).map((glyphName) =>
          b.tsLiteralType(b.stringLiteral(glyphName)),
        ),
      ),
    ),
  );

  // Add names to interface declaration
  const interfaceDeclaration = findFontPropInterface(fontName);
  if (interfaceDeclaration) {
    // ..Have to recreate existing keys (type, brand, solid),
    //   because if not, an extra semicolon is added. ??
    //   Should be able to just body.push(names) - weird bug in recast.
    //   Tried different parsers.. maybe I'm missing something? -@davidgovea
    const recreatedExisting = interfaceDeclaration.body.body
      .filter((k): k is recast.types.namedTypes.TSPropertySignature =>
        n.TSPropertySignature.check(k),
      )
      .map((k) =>
        b.tsPropertySignature(k.key, k.typeAnnotation, k.optional || false),
      );

    interfaceDeclaration.body.body = [...recreatedExisting, names];
  }
};

// Read each (non-FontAwesome5) glyphmap
fs.readdirSync(glyphmapsPath)
  .filter((glyphmapFile) => !glyphmapFile.startsWith("FontAwesome5"))
  .forEach((glyphmapFile) => {
    const fontName = glyphmapFile.replace(".json", "");
    addGlyphNames(glyphmapFile, fontName);
  });

// Use "free" glyphs for FontAwesome5
addGlyphNames("FontAwesome5Free.json", "FontAwesome5");

// Write type file back to disk
fs.writeFileSync(typeFilePath, recast.print(typeFileAst).code);
