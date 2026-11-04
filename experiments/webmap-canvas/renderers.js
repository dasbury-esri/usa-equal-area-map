export function rendererFields(renderer) {
  if (!renderer || !["simple", "unique-value", "class-breaks"].includes(renderer.type)) throw new Error(`Unsupported renderer: ${renderer?.type ?? "missing"}`);
  if (renderer.valueExpression || renderer.visualVariables?.length) {
    throw new Error("Unsupported renderer expression or visual variables");
  }
  if (renderer.normalizationType && renderer.normalizationType !== "field") throw new Error("Unsupported renderer normalization");
  return [...new Set([renderer.field, renderer.field2, renderer.field3, renderer.normalizationField].filter(Boolean))];
}

export function validateSymbol(symbol) {
  if (!symbol) return;
  if (!["simple-fill", "simple-line", "simple-marker"].includes(symbol.type)) throw new Error(`Unsupported symbol: ${symbol.type}`);
  if (symbol.type === "simple-marker" && symbol.style !== "circle") throw new Error(`Unsupported marker: ${symbol.style}`);
  if (symbol.type !== "simple-marker" && symbol.style && !["solid", "none"].includes(symbol.style)) throw new Error(`Unsupported symbol style: ${symbol.style}`);
  if (symbol.xoffset || symbol.yoffset || symbol.path || symbol.marker || symbol.effect) throw new Error("Unsupported symbol offset, path, marker, or effect");
  if (symbol.outline) validateSymbol(symbol.outline);
}

export function compileRenderer(renderer) {
  const fields = rendererFields(renderer);
  const uniqueInfos = renderer.uniqueValueGroups?.length
    ? renderer.uniqueValueGroups.flatMap(group => group.classes.flatMap(entry => entry.values.map(values => ({
      value: values.map(value => value == null ? "<Null>" : String(value)).join(renderer.fieldDelimiter ?? ", "), symbol: entry.symbol,
    })))) : renderer.uniqueValueInfos;
  const symbols = renderer.type === "simple" ? [renderer.symbol] : [renderer.defaultSymbol,
    ...(uniqueInfos ?? renderer.classBreakInfos ?? []).map(info => info.symbol)];
  symbols.forEach(validateSymbol);
  const symbolFor = attributes => {
    if (renderer.type === "simple") return renderer.symbol;
    if (renderer.type === "unique-value") {
      const value = [renderer.field, renderer.field2, renderer.field3].filter(Boolean)
        .map(field => attributes[field] == null ? "<Null>" : String(attributes[field])).join(renderer.fieldDelimiter ?? ", ");
      return uniqueInfos?.find(info => String(info.value) === value)?.symbol ?? renderer.defaultSymbol;
    }
    const raw = attributes[renderer.field];
    if (raw == null) return renderer.defaultSymbol;
    let value = Number(raw);
    if (renderer.normalizationField) {
      const divisor = Number(attributes[renderer.normalizationField]);
      if (!divisor) return renderer.defaultSymbol;
      value /= divisor;
    }
    if (!Number.isFinite(value)) return renderer.defaultSymbol;
    return renderer.classBreakInfos?.find((info, index) => (index === 0 ? value >= info.minValue : value > info.minValue)
      && value <= info.maxValue)?.symbol ?? renderer.defaultSymbol;
  };
  return { fields, symbolFor, fillOnly: symbols.filter(Boolean).every(symbol => symbol.type === "simple-fill") };
}

export function rgba(color, opacity = 1) {
  const components = color?.toRgba ? color.toRgba() : color ?? [0, 0, 0, 0];
  return [components[0] / 255, components[1] / 255, components[2] / 255, (components[3] ?? 1) * opacity];
}
