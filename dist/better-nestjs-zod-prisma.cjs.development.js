'use strict';

var generatorHelper = require('@prisma/generator-helper');
var tsMorph = require('ts-morph');
var typescript = require('typescript');
var zod = require('zod');
var path = require('path');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var path__default = /*#__PURE__*/_interopDefaultLegacy(path);

const configBoolean = /*#__PURE__*/zod.z.enum(['true', 'false']).transform(arg => arg === 'true');
const configSchema = /*#__PURE__*/zod.z.object({
  relationModel: /*#__PURE__*/configBoolean.default('true').or( /*#__PURE__*/zod.z.literal('default')),
  generateDto: /*#__PURE__*/configBoolean.default('true'),
  modelSuffix: /*#__PURE__*/zod.z.string().default('Model'),
  dtoSuffix: /*#__PURE__*/zod.z.string().default('Dto'),
  modelCase: /*#__PURE__*/zod.z.enum(['PascalCase', 'camelCase']).default('PascalCase'),
  dtoCase: /*#__PURE__*/zod.z.enum(['PascalCase', 'camelCase']).default('PascalCase'),
  useDecimalJs: /*#__PURE__*/configBoolean.default('false'),
  imports: /*#__PURE__*/zod.z.string().optional(),
  prismaJsonNullability: /*#__PURE__*/configBoolean.default('true'),
  enableOpenAPI: /*#__PURE__*/configBoolean.default('false')
});

var Directive;
(function (Directive) {
  Directive["Start"] = "@z.";
  Directive["Append"] = "@z&.";
})(Directive || (Directive = {}));
const SLICE_OFFSETS = {
  [Directive.Start]: 1,
  [Directive.Append]: 3
};
function hasDirectives(line, directives = Object.values(Directive)) {
  return directives.some(directive => {
    return line.trim().startsWith(directive);
  });
}
function hasNoDirectives(line, directives) {
  return !hasDirectives(line, directives);
}
function extractDirectiveValue(lines, directive) {
  for (const line of lines) {
    if (hasNoDirectives(line, [directive])) continue;
    return line.trim().slice(SLICE_OFFSETS[directive]);
  }
  return null;
}
const getJSDocs = docString => {
  const lines = [];
  if (docString) {
    const docLines = docString.split('\n').filter(line => hasNoDirectives(line));
    if (docLines.length > 0) {
      lines.push('/**');
      docLines.forEach(line => lines.push(` * ${line}`));
      lines.push(' */');
    }
  }
  return lines;
};
function findCustomSchema(documentation) {
  const lines = documentation.split('\n');
  return extractDirectiveValue(lines, Directive.Start);
}
function findSchemaAppends(documentation) {
  const appends = [];
  for (const line of documentation.split('\n')) {
    const append = extractDirectiveValue([line], Directive.Append);
    if (append) appends.push(append);
  }
  return appends;
}

const mapScalarType = {
  String: 'z.string()',
  Int: 'z.number().int()',
  BigInt: 'z.bigint()',
  DateTime: 'z.date()',
  Float: 'z.number()',
  Decimal: 'z.number()',
  Json: 'z.string()',
  Boolean: 'z.boolean()',
  Bytes: 'z.instanceOf(Buffer)'
};
const getZodConstructor = (field, getRelatedModelName = name => name.toString()) => {
  let schema;
  if (field.kind === 'scalar' && typeof field.type === 'string' && Object.prototype.hasOwnProperty.call(mapScalarType, field.type)) {
    schema = mapScalarType[field.type];
  } else if (field.kind === 'enum') {
    schema = `z.nativeEnum($Enums.${field.type})`;
  } else if (field.kind === 'object') {
    schema = getRelatedModelName(field.type);
  } else {
    schema = 'z.unknown()';
  }
  let isCustom = false;
  if (field.documentation) {
    const custom = findCustomSchema(field.documentation);
    const appends = findSchemaAppends(field.documentation);
    if (custom) {
      isCustom = true;
      schema = custom;
    }
    for (const append of appends) {
      schema += append;
    }
  }
  if (field.isList && !isCustom) {
    schema += '.array()';
  }
  if (!field.isRequired && field.type !== 'Json') {
    schema += '.nullable()';
  }
  return schema;
};

const writeArray = (writer, array, newLine = true) => array.forEach(line => writer.write(line).conditionalNewLine(newLine));
const useModelNames = ({
  modelCase,
  modelSuffix,
  dtoSuffix,
  dtoCase,
  relationModel
}) => {
  const formatModelName = (name, prefix = '') => {
    let result = name;
    if (modelCase === 'camelCase') {
      result = result.slice(0, 1).toLowerCase() + result.slice(1);
    }
    return `${prefix}${result}${modelSuffix}`;
  };
  const formatDtoName = name => {
    let result = name;
    if (dtoCase === 'camelCase') {
      result = result.slice(0, 1).toLowerCase() + result.slice(1);
    }
    return `${result}${dtoSuffix}`;
  };
  return {
    modelName: name => formatModelName(name, relationModel === 'default' ? '_' : ''),
    dtoName: name => formatDtoName(name),
    relatedModelName: name => formatModelName(relationModel === 'default' ? name.toString() : `Related${name.toString()}`)
  };
};
const needsRelatedModel = (model, config) => model.fields.some(field => field.kind === 'object') && config.relationModel !== false;
const dotSlash = input => {
  const converted = input.replace(/^\\\\\?\\/, '').replace(/\\/g, '/').replace(/\/\/+/g, '/');
  if (converted.includes(`/node_modules/`)) return converted.split(`/node_modules/`).slice(-1)[0];
  if (converted.startsWith(`../`)) return converted;
  return './' + converted;
};

const writeImportsForModel = (model, sourceFile, config, {
  schemaPath,
  outputPath
}) => {
  const {
    relatedModelName
  } = useModelNames(config);
  const importList = [{
    kind: tsMorph.StructureKind.ImportDeclaration,
    namespaceImport: 'z',
    moduleSpecifier: 'zod'
  }];
  if (config.enableOpenAPI) {
    // ability to use openapi in nestjs-zod
    importList.push({
      kind: tsMorph.StructureKind.ImportDeclaration,
      namedImports: ['$Enums'],
      moduleSpecifier: '@prisma/client'
    });
    // ability to use openapi in nestjs-zod
    importList.push({
      kind: tsMorph.StructureKind.ImportDeclaration,
      namedImports: ['extendZodWithOpenApi'],
      moduleSpecifier: '@anatine/zod-openapi'
    });
  }
  if (config.generateDto) {
    importList.push({
      kind: tsMorph.StructureKind.ImportDeclaration,
      namedImports: ['createZodDto'],
      moduleSpecifier: '@anatine/zod-nestjs'
    });
  }
  if (config.imports) {
    importList.push({
      kind: tsMorph.StructureKind.ImportDeclaration,
      namespaceImport: 'imports',
      moduleSpecifier: dotSlash(path__default["default"].relative(outputPath, path__default["default"].resolve(path__default["default"].dirname(schemaPath), config.imports)))
    });
  }
  if (config.useDecimalJs && model.fields.some(f => f.type === 'Decimal')) {
    importList.push({
      kind: tsMorph.StructureKind.ImportDeclaration,
      namedImports: ['Decimal'],
      moduleSpecifier: 'decimal.js'
    });
  }
  const enumFields = model.fields.filter(f => f.kind === 'enum');
  // Keep track of imported enum types
  const importedEnums = new Set();
  // Filter out duplicate enum types
  const uniqueEnumFields = enumFields.filter(f => {
    const typeName = f.type;
    if (!importedEnums.has(typeName)) {
      importedEnums.add(typeName);
      return true;
    }
    return false;
  });
  if (uniqueEnumFields.length > 0) {
    importList.push({
      kind: tsMorph.StructureKind.ImportDeclaration,
      isTypeOnly: uniqueEnumFields.length === 0,
      moduleSpecifier: dotSlash('enums'),
      namedImports: uniqueEnumFields.map(f => f.type)
    });
  }
  const relationFields = model.fields.filter(f => f.kind === 'object');
  if (config.relationModel !== false && relationFields.length > 0) {
    const filteredFields = relationFields.filter(f => f.type !== model.name);
    if (filteredFields.length > 0) {
      importList.push({
        kind: tsMorph.StructureKind.ImportDeclaration,
        moduleSpecifier: './index',
        namedImports: Array.from(new Set(filteredFields.flatMap(f => [`Complete${f.type}`, relatedModelName(f.type)])))
      });
    }
  }
  sourceFile.addImportDeclarations(importList);
  sourceFile.addVariableStatement({
    declarationKind: tsMorph.VariableDeclarationKind.Const,
    declarations: [{
      initializer: writer => writer.write('extendZodWithOpenApi(z)'),
      name: 'zodOpenApi'
    }]
  });
};
const writeTypeSpecificSchemas = (model, sourceFile, config, _prismaOptions) => {
  if (config.useDecimalJs && model.fields.some(f => f.type === 'Decimal')) {
    sourceFile.addStatements(writer => {
      writer.newLine();
      writeArray(writer, ['// Helper schema for Decimal fields', 'z', '.instanceof(Decimal)', '.or(z.string())', '.or(z.number())', '.refine((value) => {', '  try {', '    return new Decimal(value);', '  } catch (error) {', '    return false;', '  }', '})', '.transform((value) => new Decimal(value));']);
    });
  }
};
const generateSchemaForModel = (model, sourceFile, config, _prismaOptions) => {
  const {
    modelName
  } = useModelNames(config);
  sourceFile.addVariableStatement({
    declarationKind: tsMorph.VariableDeclarationKind.Const,
    isExported: true,
    leadingTrivia: writer => writer.blankLineIfLastNot(),
    declarations: [{
      name: modelName(model.name),
      initializer(writer) {
        writer.write('z.object(').inlineBlock(() => {
          model.fields.filter(f => f.kind !== 'object').forEach(field => {
            writeArray(writer, getJSDocs(field.documentation));
            writer.write(`${field.name}: ${getZodConstructor(field)}`).write(',').newLine();
          });
        }).write(')');
      }
    }]
  });
};
const generateDto = (model, sourceFile, config) => {
  const {
    modelName,
    dtoName
  } = useModelNames(config);
  sourceFile.addClass({
    name: dtoName(model.name),
    isExported: true,
    leadingTrivia: writer => writer.blankLineIfLastNot(),
    extends: `createZodDto(${modelName(model.name)})`
  });
};
const generateRelatedSchemaForModel = (model, sourceFile, config, _prismaOptions) => {
  const {
    modelName,
    relatedModelName
  } = useModelNames(config);
  const relationFields = model.fields.filter(f => f.kind === 'object');
  sourceFile.addInterface({
    name: `Complete${model.name}`,
    isExported: true,
    extends: [`z.infer<typeof ${modelName(model.name)}>`],
    properties: relationFields.map(f => ({
      hasQuestionToken: !f.isRequired,
      name: f.name,
      type: `Complete${f.type}${f.isList ? '[]' : ''}${!f.isRequired ? ' | null' : ''}?`
    }))
  });
  sourceFile.addStatements(writer => writeArray(writer, ['', '/**', ` * ${relatedModelName(model.name)} contains all relations on your model in addition to the scalars`, ' *', ' * NOTE: Lazy required in case of potential circular dependencies within schema', ' */']));
  sourceFile.addVariableStatement({
    declarationKind: tsMorph.VariableDeclarationKind.Const,
    isExported: true,
    declarations: [{
      name: relatedModelName(model.name),
      type: `z.ZodSchema<Complete${model.name}>`,
      initializer(writer) {
        writer.write(`z.lazy(() => ${modelName(model.name)}.extend(`).inlineBlock(() => {
          relationFields.forEach(field => {
            writeArray(writer, getJSDocs(field.documentation));
            writer.write(`${field.name}: ${getZodConstructor(field, relatedModelName)}`).write(',').newLine();
          });
        }).write('))');
      }
    }]
  });
};
const populateModelFile = (model, sourceFile, config, prismaOptions) => {
  writeImportsForModel(model, sourceFile, config, prismaOptions);
  writeTypeSpecificSchemas(model, sourceFile, config);
  generateSchemaForModel(model, sourceFile, config);
  if (config.generateDto) generateDto(model, sourceFile, config);
  if (needsRelatedModel(model, config)) generateRelatedSchemaForModel(model, sourceFile, config);
};
const generateBarrelFile = (models, indexFile) => {
  models.forEach(model => indexFile.addExportDeclaration({
    moduleSpecifier: `./${model.name.toLowerCase()}`
  }));
};
const generateEnumsFile = (enums, enumsFile) => {
  for (const {
    name,
    values
  } of enums) {
    const members = values.map(({
      name: memberName
    }) => {
      return {
        name: memberName,
        value: memberName
      };
    });
    enumsFile.addEnum({
      name,
      members
    }).setIsExported(true);
  }
};

const {
  version
} = /*#__PURE__*/require('../package.json');
generatorHelper.generatorHandler({
  onManifest() {
    return {
      version,
      prettyName: 'NestJS Zod Schemas',
      defaultOutput: './src/zod'
    };
  },
  onGenerate(options) {
    const project = new tsMorph.Project();
    const models = options.dmmf.datamodel.models;
    const enums = options.dmmf.datamodel.enums;
    const {
      schemaPath
    } = options;
    const outputPath = options.generator.output.value;
    const clientPath = options.otherGenerators.find(each => each.provider.value === 'prisma-client-js').output.value;
    const results = configSchema.safeParse(options.generator.config);
    if (!results.success) throw new Error('Incorrect config provided. Please check the values you provided and try again.');
    const config = results.data;
    const prismaOptions = {
      clientPath,
      outputPath,
      schemaPath
    };
    const indexFile = project.createSourceFile(`${outputPath}/index.ts`, {}, {
      overwrite: true
    });
    generateBarrelFile(models, indexFile);
    indexFile.formatText({
      indentSize: 2,
      convertTabsToSpaces: true,
      semicolons: typescript.SemicolonPreference.Remove
    });
    models.forEach(model => {
      const sourceFile = project.createSourceFile(`${outputPath}/${model.name.toLowerCase()}.ts`, {}, {
        overwrite: true
      });
      populateModelFile(model, sourceFile, config, prismaOptions);
      sourceFile.formatText({
        indentSize: 2,
        convertTabsToSpaces: true,
        semicolons: typescript.SemicolonPreference.Remove
      });
    });
    if (enums.length > 0) {
      const enumsFile = project.createSourceFile(`${outputPath}/enums.ts`, {}, {
        overwrite: true
      });
      generateEnumsFile(enums, enumsFile);
      enumsFile.formatText({
        indentSize: 2,
        convertTabsToSpaces: true,
        semicolons: typescript.SemicolonPreference.Remove
      });
    }
    return project.save();
  }
});
//# sourceMappingURL=better-nestjs-zod-prisma.cjs.development.js.map
