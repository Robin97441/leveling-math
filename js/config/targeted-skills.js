// Configuration et generateurs du mode Entrainement cible.
// Les questions conservent le format du moteur general, mais leurs regles de
// progression et leur persistance restent entierement separees.

const TARGETED_DIFFICULTY_ORDER = ["beginner", "intermediate", "expert"];

function targetedRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function targetedChoice(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function targetedNonZero(min, max) {
  let value = 0;
  while (value === 0) value = targetedRandomInt(min, max);
  return value;
}

function targetedShuffle(values) {
  const result = values.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = targetedRandomInt(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function targetedFormatPolynomial(a, b, c, d = 0) {
  const parts = [];
  const append = (coefficient, variable = "") => {
    if (coefficient === 0) return;
    const magnitude = Math.abs(coefficient);
    const value = variable && magnitude === 1 ? variable : `${magnitude}${variable}`;
    if (parts.length === 0) parts.push(coefficient < 0 ? `-${value}` : value);
    else parts.push(`${coefficient < 0 ? "-" : "+"} ${value}`);
  };
  append(d, "x³");
  append(a, "x²");
  append(b, "x");
  append(c);
  return parts.length ? parts.join(" ") : "0";
}

function targetedFormatComponents(components) {
  return components.map((component, index) => {
    const coefficient = component.coefficient;
    const magnitude = Math.abs(coefficient);
    const variable = component.kind === "x3" ? "x³" : component.kind === "x2" ? "x²" : component.kind === "x" ? "x" : "";
    const value = variable && magnitude === 1 ? variable : `${magnitude}${variable}`;
    if (index === 0) return coefficient < 0 ? `-${value}` : value;
    return `${coefficient < 0 ? "-" : "+"} ${value}`;
  }).join(" ");
}

function getTargetedProgressTier(difficultyXp) {
  const xp = Math.max(0, Math.min(500, Number(difficultyXp) || 0));
  if (xp >= 300) return 3;
  if (xp >= 100) return 2;
  return 1;
}

function targetedPolynomialQuestion({ text, d = 0, a = 0, b = 0, c = 0, difficulty, subskillKey, correctionSteps = [], componentCount = null, progressTier, questionFamily = null }) {
  const polynomial = { kind: "polynomial", d, a, b, c };
  return {
    text,
    answer: { ...polynomial, value: polynomial },
    answerDisplay: targetedFormatPolynomial(a, b, c, d),
    timeLimit: difficulty === "beginner" ? 20 : difficulty === "intermediate" ? 25 : 30,
    category: "calcul_litteral",
    subcategory: subskillKey,
    subskillKey,
    correctionSteps,
    componentCount,
    progressTier,
    questionFamily,
    targeted: true
  };
}

function generateTargetedLiteralBeginner(difficultyXp = 0) {
  const progressTier = getTargetedProgressTier(difficultyXp);
  for (let attempt = 0; attempt < 50; attempt++) {
    const componentCount = progressTier === 1
      ? 2
      : progressTier === 2 ? targetedRandomInt(2, 3) : targetedRandomInt(3, 4);
    let constantCount;
    if (progressTier === 3 && componentCount === 4) {
      constantCount = 2;
    } else if (progressTier === 2 && componentCount === 3) {
      constantCount = targetedChoice([1, 2]);
    } else {
      const includesConstants = Math.random() < 0.58;
      constantCount = includesConstants ? targetedRandomInt(1, Math.min(2, componentCount - 1)) : 0;
    }
    const includesConstants = constantCount > 0;
    const xCount = componentCount - constantCount;
    const components = [];
    for (let i = 0; i < xCount; i++) {
      components.push({ kind: "x", coefficient: targetedNonZero(-15, 15) });
    }
    for (let i = xCount; i < componentCount; i++) {
      components.push({ kind: "constant", coefficient: targetedNonZero(-12, 12) });
    }
    const shuffled = targetedShuffle(components);
    const b = components.filter(item => item.kind === "x").reduce((sum, item) => sum + item.coefficient, 0);
    const c = components.filter(item => item.kind === "constant").reduce((sum, item) => sum + item.coefficient, 0);
    if (b === 0 && c === 0) continue;
    return targetedPolynomialQuestion({
      text: targetedFormatComponents(shuffled),
      b,
      c,
      difficulty: "beginner",
      subskillKey: includesConstants ? "reduction_constantes_x" : "reduction_termes_x",
      componentCount,
      progressTier
    });
  }
  return targetedPolynomialQuestion({
    text: "2x + x",
    b: 3,
    difficulty: "beginner",
    subskillKey: "reduction_termes_x",
    componentCount: 2,
    progressTier
  });
}

function targetedMonomial(coefficient, squared = false) {
  const variable = squared ? "x²" : "x";
  if (coefficient === 1) return variable;
  if (coefficient === -1) return `-${variable}`;
  return `${coefficient}${variable}`;
}

function generateTargetedLiteralIntermediate(difficultyXp = 0) {
  const progressTier = getTargetedProgressTier(difficultyXp);
  const testsSquare = Math.random() < 0.5;

  if (progressTier === 1) {
    if (testsSquare) {
      const left = targetedNonZero(-6, 6);
      const right = targetedNonZero(-6, 6);
      return targetedPolynomialQuestion({
        text: `${targetedMonomial(left)} × ${targetedMonomial(right)}`,
        a: left * right,
        difficulty: "intermediate",
        subskillKey: "multiplication_x_carre",
        componentCount: 2,
        progressTier
      });
    }
    const coefficient = targetedNonZero(-7, 7);
    const multiplier = targetedChoice([2, 3, 4, 5, 6]);
    const reverse = Math.random() < 0.5;
    return targetedPolynomialQuestion({
      text: reverse
        ? `${multiplier} × ${targetedMonomial(coefficient)}`
        : `${targetedMonomial(coefficient)} × ${multiplier}`,
      b: coefficient * multiplier,
      difficulty: "intermediate",
      subskillKey: "multiplication_monomes",
      componentCount: 2,
      progressTier
    });
  }

  if (progressTier === 2) {
    const left = targetedNonZero(-6, 6);
    const right = testsSquare ? targetedNonZero(-6, 6) : targetedChoice([2, 3, 4, 5, 6]);
    const extraX = targetedNonZero(-7, 7);
    const productText = testsSquare
      ? `${targetedMonomial(left)} × ${targetedMonomial(right)}`
      : `${targetedMonomial(left)} × ${right}`;
    return targetedPolynomialQuestion({
      text: `${productText} ${extraX < 0 ? "-" : "+"} ${targetedMonomial(Math.abs(extraX))}`,
      a: testsSquare ? left * right : 0,
      b: testsSquare ? extraX : left * right + extraX,
      difficulty: "intermediate",
      subskillKey: testsSquare ? "multiplication_x_carre" : "multiplication_monomes",
      componentCount: 3,
      progressTier
    });
  }

  const family = targetedRandomInt(1, 4);
  const appendXTerm = coefficient => `${coefficient < 0 ? "-" : "+"} ${targetedMonomial(Math.abs(coefficient))}`;

  if (family === 1) {
    const left = targetedNonZero(-6, 6);
    const right = targetedNonZero(-6, 6);
    let firstExtraX;
    let secondExtraX;
    do {
      firstExtraX = targetedNonZero(-8, 8);
      secondExtraX = targetedNonZero(-8, 8);
    } while (firstExtraX + secondExtraX === 0);
    return targetedPolynomialQuestion({
      text: `${targetedMonomial(left)} × ${targetedMonomial(right)} ${appendXTerm(firstExtraX)} ${appendXTerm(secondExtraX)}`,
      a: left * right,
      b: firstExtraX + secondExtraX,
      difficulty: "intermediate",
      subskillKey: "multiplication_x_carre",
      componentCount: 4,
      progressTier
    });
  }

  if (family === 2) {
    let left;
    let right;
    let secondLeft;
    let secondRight;
    let operationSign;
    do {
      left = targetedNonZero(-6, 6);
      right = targetedNonZero(-6, 6);
      secondLeft = targetedChoice([2, 3, 4, 5, 6]);
      secondRight = targetedChoice([2, 3, 4, 5, 6]);
      operationSign = Math.random() < 0.5 ? -1 : 1;
    } while (left * right + operationSign * secondLeft * secondRight === 0);
    return targetedPolynomialQuestion({
      text: `${targetedMonomial(left)} × ${targetedMonomial(right)} ${operationSign < 0 ? "-" : "+"} ${targetedMonomial(secondLeft)} × ${targetedMonomial(secondRight)}`,
      a: left * right + operationSign * secondLeft * secondRight,
      difficulty: "intermediate",
      subskillKey: "multiplication_x_carre",
      componentCount: 4,
      progressTier
    });
  }

  if (family === 3) {
    const coefficient = targetedNonZero(-7, 7);
    const multiplier = targetedChoice([2, 3, 4, 5, 6]);
    const reverse = Math.random() < 0.5;
    let firstExtraX;
    let secondExtraX;
    do {
      firstExtraX = targetedNonZero(-8, 8);
      secondExtraX = targetedNonZero(-8, 8);
    } while (coefficient * multiplier + firstExtraX + secondExtraX === 0);
    const productText = reverse
      ? `${multiplier} × ${targetedMonomial(coefficient)}`
      : `${targetedMonomial(coefficient)} × ${multiplier}`;
    return targetedPolynomialQuestion({
      text: `${productText} ${appendXTerm(firstExtraX)} ${appendXTerm(secondExtraX)}`,
      b: coefficient * multiplier + firstExtraX + secondExtraX,
      difficulty: "intermediate",
      subskillKey: "multiplication_monomes",
      componentCount: 4,
      progressTier
    });
  }

  let firstCoefficient;
  let firstMultiplier;
  let secondCoefficient;
  let secondMultiplier;
  let operationSign;
  do {
    firstCoefficient = targetedNonZero(-7, 7);
    firstMultiplier = targetedChoice([2, 3, 4, 5, 6]);
    secondCoefficient = targetedChoice([1, 2, 3, 4, 5, 6]);
    secondMultiplier = targetedChoice([2, 3, 4, 5, 6]);
    operationSign = Math.random() < 0.5 ? -1 : 1;
  } while (firstCoefficient * firstMultiplier + operationSign * secondCoefficient * secondMultiplier === 0);
  const firstProduct = Math.random() < 0.5
    ? `${firstMultiplier} × ${targetedMonomial(firstCoefficient)}`
    : `${targetedMonomial(firstCoefficient)} × ${firstMultiplier}`;
  const secondProduct = Math.random() < 0.5
    ? `${secondMultiplier} × ${targetedMonomial(secondCoefficient)}`
    : `${targetedMonomial(secondCoefficient)} × ${secondMultiplier}`;
  return targetedPolynomialQuestion({
    text: `${firstProduct} ${operationSign < 0 ? "-" : "+"} ${secondProduct}`,
    b: firstCoefficient * firstMultiplier + operationSign * secondCoefficient * secondMultiplier,
    difficulty: "intermediate",
    subskillKey: "multiplication_monomes",
    componentCount: 4,
    progressTier
  });
}

const TARGETED_EXPERT_FAMILIES_BY_TIER = {
  1: [
    { key: "reduction", weight: 1 },
    { key: "parentheses", weight: 1 },
    { key: "distribution", weight: 1 },
    { key: "monomial_product", weight: 1 }
  ],
  2: [
    { key: "reduction", weight: 0.8 },
    { key: "parentheses", weight: 0.8 },
    { key: "distribution", weight: 1.25 },
    { key: "inverse_distribution", weight: 1.2 },
    { key: "monomial_product", weight: 1.1 },
    { key: "product_reduction", weight: 1.1 }
  ],
  3: [
    { key: "reduction", weight: 1 },
    { key: "parentheses", weight: 1 },
    { key: "distribution", weight: 1 },
    { key: "inverse_distribution", weight: 1 },
    { key: "monomial_product", weight: 1.3 },
    { key: "product_reduction", weight: 1.7 }
  ]
};

function targetedWeightedChoice(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let draw = Math.random() * totalWeight;
  for (const entry of entries) {
    draw -= entry.weight;
    if (draw <= 0) return entry;
  }
  return entries[entries.length - 1];
}

function selectTargetedExpertFamily(progressTier, context = {}) {
  const familyConfigs = TARGETED_EXPERT_FAMILIES_BY_TIER[progressTier];
  const previousQuestions = Array.isArray(context.previousQuestions) ? context.previousQuestions : [];
  if (previousQuestions.length === 0) return targetedWeightedChoice(familyConfigs).key;

  const familyCounts = Object.fromEntries(familyConfigs.map(({ key }) => [key, 0]));
  for (const question of previousQuestions) {
    if (question?.questionFamily in familyCounts) familyCounts[question.questionFamily]++;
  }
  const previousFamily = previousQuestions[previousQuestions.length - 1]?.questionFamily;
  const withoutImmediateRepeat = familyConfigs.filter(({ key }) => key !== previousFamily);
  const candidates = withoutImmediateRepeat.length ? withoutImmediateRepeat : familyConfigs;
  const minimumLoad = Math.min(...candidates.map(({ key, weight }) => familyCounts[key] / weight));
  const leastRepresented = candidates.filter(({ key, weight }) => familyCounts[key] / weight <= minimumLoad + 0.05);
  return targetedWeightedChoice(leastRepresented).key;
}

function targetedSignedCoefficient(maximum, negativeProbability = 0.5) {
  const magnitude = targetedRandomInt(1, maximum);
  return Math.random() < negativeProbability ? -magnitude : magnitude;
}

function targetedMonomialOfDegree(coefficient, degree) {
  const variable = degree === 3 ? "x³" : degree === 2 ? "x²" : "x";
  if (coefficient === 1) return variable;
  if (coefficient === -1) return `-${variable}`;
  return `${coefficient}${variable}`;
}

function targetedComponentKind(degree) {
  return degree === 3 ? "x3" : degree === 2 ? "x2" : "x";
}

function buildTargetedExpertReduction(progressTier) {
  const templates = progressTier === 1
    ? [["x", "x", "constant", "constant"], ["x2", "x2", "x", "x"]]
    : progressTier === 2
      ? [["x", "x", "constant", "constant"], ["x2", "x2", "x", "x"], ["x2", "x2", "constant", "constant"]]
      : [["x2", "x2", "x", "x", "constant"], ["x3", "x3", "x2", "x2", "x"], ["x3", "x3", "x", "x", "constant"]];
  const negativeProbability = progressTier === 3 ? 0.65 : 0.5;

  for (let attempt = 0; attempt < 40; attempt++) {
    const components = targetedChoice(templates).map(kind => ({
      kind,
      coefficient: targetedSignedCoefficient(progressTier === 3 ? 9 : 7, negativeProbability)
    }));
    const coefficientFor = kind => components
      .filter(component => component.kind === kind)
      .reduce((sum, component) => sum + component.coefficient, 0);
    const d = coefficientFor("x3");
    const a = coefficientFor("x2");
    const b = coefficientFor("x");
    const c = coefficientFor("constant");
    if (d === 0 && a === 0 && b === 0 && c === 0) continue;
    const answerDisplay = targetedFormatPolynomial(a, b, c, d);
    return targetedPolynomialQuestion({
      text: targetedFormatComponents(targetedShuffle(components)),
      d,
      a,
      b,
      c,
      difficulty: "expert",
      subskillKey: "reduction_termes",
      correctionSteps: [answerDisplay],
      componentCount: components.length,
      progressTier,
      questionFamily: "reduction"
    });
  }
  return targetedPolynomialQuestion({
    text: "7x - 4 + 3x + 9",
    b: 10,
    c: 5,
    difficulty: "expert",
    subskillKey: "reduction_termes",
    correctionSteps: ["10x + 5"],
    componentCount: 4,
    progressTier,
    questionFamily: "reduction"
  });
}

function buildTargetedExpertParentheses(progressTier) {
  const negativeProbability = progressTier === 3 ? 0.65 : 0.5;
  for (let attempt = 0; attempt < 40; attempt++) {
    const outsideComponents = [
      { kind: "x", coefficient: targetedSignedCoefficient(progressTier === 3 ? 9 : 7, negativeProbability) }
    ];
    if (progressTier > 1 || Math.random() < 0.65) {
      outsideComponents.push({ kind: "constant", coefficient: targetedSignedCoefficient(9, negativeProbability) });
    }
    const orderedOutside = targetedShuffle(outsideComponents);
    const insideX = targetedSignedCoefficient(progressTier === 3 ? 8 : 6, negativeProbability);
    const insideConstant = targetedSignedCoefficient(8, negativeProbability);
    const parenthesesSign = Math.random() < (progressTier === 3 ? 0.65 : 0.5) ? -1 : 1;
    const b = outsideComponents.filter(component => component.kind === "x")
      .reduce((sum, component) => sum + component.coefficient, 0) + parenthesesSign * insideX;
    const c = outsideComponents.filter(component => component.kind === "constant")
      .reduce((sum, component) => sum + component.coefficient, 0) + parenthesesSign * insideConstant;
    if (b === 0 && c === 0) continue;
    const expandedComponents = [
      ...orderedOutside,
      { kind: "x", coefficient: parenthesesSign * insideX },
      { kind: "constant", coefficient: parenthesesSign * insideConstant }
    ];
    return targetedPolynomialQuestion({
      text: `${targetedFormatComponents(orderedOutside)} ${parenthesesSign < 0 ? "-" : "+"} (${targetedFormatPolynomial(0, insideX, insideConstant)})`,
      b,
      c,
      difficulty: "expert",
      subskillKey: "parentheses_signe_moins",
      correctionSteps: [targetedFormatComponents(expandedComponents), targetedFormatPolynomial(0, b, c)],
      componentCount: outsideComponents.length + 2,
      progressTier,
      questionFamily: "parentheses"
    });
  }
  return targetedPolynomialQuestion({
    text: "5x - (2x + 3)",
    b: 3,
    c: -3,
    difficulty: "expert",
    subskillKey: "parentheses_signe_moins",
    correctionSteps: ["5x - 2x - 3", "3x - 3"],
    componentCount: 3,
    progressTier,
    questionFamily: "parentheses"
  });
}

function buildTargetedExpertDistribution(progressTier, placement) {
  const negativeProbability = progressTier === 3 ? 0.65 : 0.5;
  const kMagnitude = targetedRandomInt(2, progressTier === 3 ? 6 : 5);
  const k = Math.random() < negativeProbability ? -kMagnitude : kMagnitude;
  const p = targetedRandomInt(1, progressTier === 3 ? 6 : 5);
  const innerConstant = targetedSignedCoefficient(8, negativeProbability);
  const inner = targetedFormatPolynomial(0, p, innerConstant);
  const distributedX = k * p;
  const distributedConstant = k * innerConstant;
  const hasOutsideTerm = placement === "before" || progressTier > 1 || Math.random() < 0.55;

  if (!hasOutsideTerm) {
    const answerDisplay = targetedFormatPolynomial(0, distributedX, distributedConstant);
    return targetedPolynomialQuestion({
      text: `${k}(${inner})`,
      b: distributedX,
      c: distributedConstant,
      difficulty: "expert",
      subskillKey: "distributivite_simple",
      correctionSteps: [answerDisplay],
      componentCount: 3,
      progressTier,
      questionFamily: "distribution"
    });
  }

  const outsideKind = Math.random() < 0.5 ? "x" : "constant";
  const outsideCoefficient = targetedSignedCoefficient(8, negativeProbability);
  const outsideTerm = outsideKind === "x"
    ? targetedMonomialOfDegree(outsideCoefficient, 1)
    : String(outsideCoefficient);
  const outsideMagnitude = outsideKind === "x"
    ? targetedMonomialOfDegree(Math.abs(outsideCoefficient), 1)
    : String(Math.abs(outsideCoefficient));
  const distributionMagnitude = `${Math.abs(k)}(${inner})`;
  const text = placement === "before"
    ? `${outsideTerm} ${k < 0 ? "-" : "+"} ${distributionMagnitude}`
    : `${k}(${inner}) ${outsideCoefficient < 0 ? "-" : "+"} ${outsideMagnitude}`;
  const outsideComponent = { kind: outsideKind, coefficient: outsideCoefficient };
  const expandedComponents = placement === "before"
    ? [outsideComponent, { kind: "x", coefficient: distributedX }, { kind: "constant", coefficient: distributedConstant }]
    : [{ kind: "x", coefficient: distributedX }, { kind: "constant", coefficient: distributedConstant }, outsideComponent];
  const b = distributedX + (outsideKind === "x" ? outsideCoefficient : 0);
  const c = distributedConstant + (outsideKind === "constant" ? outsideCoefficient : 0);

  return targetedPolynomialQuestion({
    text,
    b,
    c,
    difficulty: "expert",
    subskillKey: "distributivite_simple",
    correctionSteps: [targetedFormatComponents(expandedComponents), targetedFormatPolynomial(0, b, c)],
    componentCount: 4,
    progressTier,
    questionFamily: placement === "before" ? "inverse_distribution" : "distribution"
  });
}

function buildTargetedExpertMonomialProduct(progressTier) {
  const degreePairs = progressTier === 1
    ? [[1, 1]]
    : progressTier === 2
      ? [[1, 1], [1, 2], [2, 1]]
      : [[1, 1], [1, 2], [2, 1], [1, 2], [2, 1]];
  const [leftDegree, rightDegree] = targetedChoice(degreePairs);
  const negativeProbability = progressTier === 3 ? 0.65 : 0.5;
  const leftCoefficient = targetedSignedCoefficient(progressTier === 3 ? 6 : 5, negativeProbability);
  const rightCoefficient = targetedSignedCoefficient(progressTier === 3 ? 6 : 5, negativeProbability);
  const resultDegree = leftDegree + rightDegree;
  const resultCoefficient = leftCoefficient * rightCoefficient;
  const d = resultDegree === 3 ? resultCoefficient : 0;
  const a = resultDegree === 2 ? resultCoefficient : 0;
  const rightTerm = targetedMonomialOfDegree(rightCoefficient, rightDegree);
  const text = `${targetedMonomialOfDegree(leftCoefficient, leftDegree)} × ${rightCoefficient < 0 ? `(${rightTerm})` : rightTerm}`;
  const answerDisplay = targetedFormatPolynomial(a, 0, 0, d);
  return targetedPolynomialQuestion({
    text,
    d,
    a,
    difficulty: "expert",
    subskillKey: "multiplication_monomes",
    correctionSteps: [answerDisplay],
    componentCount: 2,
    progressTier,
    questionFamily: "monomial_product"
  });
}

function buildTargetedExpertProductReduction(progressTier) {
  const degreePairs = progressTier === 2
    ? [[1, 1], [1, 2], [2, 1]]
    : [[1, 1], [1, 2], [2, 1], [1, 2], [2, 1]];
  const negativeProbability = progressTier === 3 ? 0.68 : 0.5;
  for (let attempt = 0; attempt < 40; attempt++) {
    const [leftDegree, rightDegree] = targetedChoice(degreePairs);
    const resultDegree = leftDegree + rightDegree;
    const leftCoefficient = targetedSignedCoefficient(progressTier === 3 ? 6 : 5, negativeProbability);
    const rightCoefficient = targetedSignedCoefficient(progressTier === 3 ? 6 : 5, negativeProbability);
    const productCoefficient = leftCoefficient * rightCoefficient;
    const extraCoefficient = targetedSignedCoefficient(progressTier === 3 ? 9 : 7, negativeProbability);
    const finalCoefficient = productCoefficient + extraCoefficient;
    if (finalCoefficient === 0) continue;
    const d = resultDegree === 3 ? finalCoefficient : 0;
    const a = resultDegree === 2 ? finalCoefficient : 0;
    const rightTerm = targetedMonomialOfDegree(rightCoefficient, rightDegree);
    const extraMagnitude = targetedMonomialOfDegree(Math.abs(extraCoefficient), resultDegree);
    const productText = `${targetedMonomialOfDegree(leftCoefficient, leftDegree)} × ${rightCoefficient < 0 ? `(${rightTerm})` : rightTerm}`;
    const reducedProduct = targetedFormatComponents([
      { kind: targetedComponentKind(resultDegree), coefficient: productCoefficient },
      { kind: targetedComponentKind(resultDegree), coefficient: extraCoefficient }
    ]);
    return targetedPolynomialQuestion({
      text: `${productText} ${extraCoefficient < 0 ? "-" : "+"} ${extraMagnitude}`,
      d,
      a,
      difficulty: "expert",
      subskillKey: "multiplication_monomes",
      correctionSteps: [reducedProduct, targetedFormatPolynomial(a, 0, 0, d)],
      componentCount: 3,
      progressTier,
      questionFamily: "product_reduction"
    });
  }
  return targetedPolynomialQuestion({
    text: "3x × 2x + 4x²",
    a: 10,
    difficulty: "expert",
    subskillKey: "multiplication_monomes",
    correctionSteps: ["6x² + 4x²", "10x²"],
    componentCount: 3,
    progressTier,
    questionFamily: "product_reduction"
  });
}

function generateTargetedLiteralExpert(difficultyXp = 0, context = {}) {
  const progressTier = getTargetedProgressTier(difficultyXp);
  const family = selectTargetedExpertFamily(progressTier, context);
  if (family === "reduction") return buildTargetedExpertReduction(progressTier);
  if (family === "parentheses") return buildTargetedExpertParentheses(progressTier);
  if (family === "distribution") return buildTargetedExpertDistribution(progressTier, "after");
  if (family === "inverse_distribution") return buildTargetedExpertDistribution(progressTier, "before");
  if (family === "monomial_product") return buildTargetedExpertMonomialProduct(progressTier);
  return buildTargetedExpertProductReduction(progressTier);
}

const TARGETED_SKILLS = {
  calcul_litteral: {
    key: "calcul_litteral",
    icon: "x²",
    label: "Calcul littéral",
    description: "Réduire, multiplier et développer des expressions.",
    difficulties: {
      beginner: { label: "Débutant", xpMax: 500, generator: generateTargetedLiteralBeginner },
      intermediate: { label: "Intermédiaire", xpMax: 500, generator: generateTargetedLiteralIntermediate },
      expert: { label: "Expert", xpMax: 500, generator: generateTargetedLiteralExpert }
    }
  }
};

function generateTargetedQuestion(skillKey, difficulty, difficultyXp = 0, context = {}) {
  const generator = TARGETED_SKILLS[skillKey]?.difficulties?.[difficulty]?.generator;
  if (!generator) throw new Error(`Compétence ciblée inconnue : ${skillKey}/${difficulty}`);
  return generator(difficultyXp, context);
}

function generateTargetedQuestions(skillKey, difficulty, count = 10, difficultyXp = 0) {
  const questions = [];
  for (let i = 0; i < count; i++) {
    const context = { previousQuestions: questions, questionIndex: i, questionCount: count };
    let question = generateTargetedQuestion(skillKey, difficulty, difficultyXp, context);
    let attempts = 0;
    while (questions.some(existing => existing.text === question.text) && attempts < 12) {
      question = generateTargetedQuestion(skillKey, difficulty, difficultyXp, context);
      attempts++;
    }
    questions.push(question);
  }
  return questions;
}

if (typeof window !== "undefined") {
  window.TARGETED_SKILLS = TARGETED_SKILLS;
  window.getTargetedProgressTier = getTargetedProgressTier;
  window.generateTargetedQuestion = generateTargetedQuestion;
  window.generateTargetedQuestions = generateTargetedQuestions;
}
