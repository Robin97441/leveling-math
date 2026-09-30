(function initializeMathRenderer(global) {
  "use strict";

  const renderedElements = new Set();

  function tokenize(source) {
    const tokens = [];
    let index = 0;
    while (index < source.length) {
      const rest = source.slice(index);
      const whitespace = rest.match(/^\s+/);
      if (whitespace) {
        index += whitespace[0].length;
        continue;
      }

      const number = rest.match(/^\d+(?:[.,]\d+)?/);
      if (number) {
        tokens.push({ type: "number", value: number[0] });
        index += number[0].length;
        continue;
      }

      const identifier = rest.match(/^[A-Za-z]+/);
      if (identifier) {
        const value = identifier[0];
        tokens.push({ type: value.toLowerCase() === "de" ? "of" : "identifier", value });
        index += value.length;
        continue;
      }

      const character = source[index];
      const tokenTypes = {
        "+": "plus", "-": "minus", "−": "minus",
        "×": "times", "*": "times", "·": "times",
        "÷": "divide", "/": "slash", "^": "power",
        "(": "leftParen", ")": "rightParen",
        "√": "sqrt", "|": "absolute", "%": "percent",
        "²": "superscript", "³": "superscript"
      };
      const type = tokenTypes[character];
      if (!type) throw new Error(`Symbole mathématique non reconnu : ${character}`);
      tokens.push({ type, value: type === "superscript" ? (character === "²" ? "2" : "3") : character });
      index++;
    }
    return tokens;
  }

  function parseMathExpression(source) {
    const tokens = tokenize(source);
    let position = 0;
    let absoluteDepth = 0;
    const peek = () => tokens[position] || null;
    const consume = type => {
      const token = peek();
      if (!token || token.type !== type) throw new Error(`Token ${type} attendu`);
      position++;
      return token;
    };
    const startsImplicitProduct = token => token && [
      "number", "identifier", "leftParen", "sqrt", "absolute"
    ].includes(token.type) && !(token.type === "absolute" && absoluteDepth > 0);

    function parseAdditive() {
      let node = parseMultiplicative();
      while (peek()?.type === "plus" || peek()?.type === "minus") {
        const operator = tokens[position++].type;
        node = { type: operator, left: node, right: parseMultiplicative() };
      }
      return node;
    }

    function parseMultiplicative() {
      let node = parseImplicitProduct();
      while (true) {
        const token = peek();
        if (["times", "divide", "of"].includes(token?.type)) {
          position++;
          node = { type: token.type, left: node, right: parseImplicitProduct() };
        } else {
          break;
        }
      }
      return node;
    }

    function parseImplicitProduct() {
      let node = parseUnary();
      while (true) {
        const token = peek();
        if (token?.type === "slash") {
          position++;
          node = { type: "fraction", numerator: node, denominator: parseUnary() };
        } else if (startsImplicitProduct(token)) {
          node = { type: "implicit", left: node, right: parseUnary() };
        } else {
          break;
        }
      }
      return node;
    }

    function parseUnary() {
      if (peek()?.type === "plus" || peek()?.type === "minus") {
        const operator = tokens[position++].type;
        return { type: "unary", operator, value: parseUnary() };
      }
      return parsePower();
    }

    function parsePower() {
      let node = parseAtom();
      while (peek()?.type === "power" || peek()?.type === "superscript") {
        const token = tokens[position++];
        const exponent = token.type === "superscript"
          ? { type: "number", value: token.value }
          : parseUnary();
        node = { type: "power", base: node, exponent };
      }
      while (peek()?.type === "percent") {
        position++;
        node = { type: "percent", value: node };
      }
      return node;
    }

    function parseAtom() {
      const token = peek();
      if (!token) throw new Error("Expression mathématique incomplète");
      if (token.type === "number" || token.type === "identifier") {
        position++;
        return token;
      }
      if (token.type === "leftParen") {
        position++;
        const value = parseAdditive();
        consume("rightParen");
        return { type: "group", value };
      }
      if (token.type === "sqrt") {
        position++;
        return { type: "sqrt", value: parseAtom() };
      }
      if (token.type === "absolute") {
        position++;
        absoluteDepth++;
        const value = parseAdditive();
        absoluteDepth--;
        consume("absolute");
        return { type: "absoluteValue", value };
      }
      throw new Error(`Expression inattendue : ${token.value}`);
    }

    if (tokens.length === 0) throw new Error("Expression mathématique vide");
    const tree = parseAdditive();
    if (position !== tokens.length) throw new Error(`Expression non analysée : ${tokens[position].value}`);
    return tree;
  }

  function escapeLatexText(value) {
    return String(value).replace(/[\\{}%$#&_]/g, match => `\\${match}`);
  }

  function renderTree(node) {
    switch (node.type) {
      case "number":
        return node.value.replace(",", "{,}");
      case "identifier":
        return node.value.length === 1 ? node.value : `\\mathrm{${escapeLatexText(node.value)}}`;
      case "plus":
        return `${renderTree(node.left)} + ${renderTree(node.right)}`;
      case "minus":
        return `${renderTree(node.left)} - ${renderTree(node.right)}`;
      case "times":
        return `${renderTree(node.left)} \\times ${renderTree(node.right)}`;
      case "divide":
        return `${renderTree(node.left)} \\div ${renderTree(node.right)}`;
      case "of":
        return `${renderTree(node.left)}\\;\\text{de}\\;${renderTree(node.right)}`;
      case "implicit":
        return `${renderTree(node.left)}${renderTree(node.right)}`;
      case "unary":
        return `${node.operator === "minus" ? "-" : "+"}${renderTree(node.value)}`;
      case "group":
        return `\\left(${renderTree(node.value)}\\right)`;
      case "fraction":
        return `\\frac{${renderFractionPart(node.numerator)}}{${renderFractionPart(node.denominator)}}`;
      case "power":
        return `{${renderTree(node.base)}}^{${renderTree(node.exponent)}}`;
      case "sqrt":
        return `\\sqrt{${renderFractionPart(node.value)}}`;
      case "absoluteValue":
        return `\\left|${renderTree(node.value)}\\right|`;
      case "percent":
        return `${renderTree(node.value)}\\%`;
      default:
        throw new Error(`Nœud mathématique inconnu : ${node.type}`);
    }
  }

  function renderFractionPart(node) {
    return renderTree(node.type === "group" ? node.value : node);
  }

  function expressionToLatex(expression) {
    const source = String(expression ?? "").trim();
    if (!source) return "";
    const colonIndex = source.indexOf(":");
    if (colonIndex > 0) {
      const prefix = source.slice(0, colonIndex + 1).trim();
      const expressionPart = source.slice(colonIndex + 1).trim();
      return `\\text{${escapeLatexText(prefix)}}\\;${renderTree(parseMathExpression(expressionPart))}`;
    }
    return renderTree(parseMathExpression(source));
  }

  function fitMathToContainer(element) {
    if (!element?.classList.contains("math-rendered")) return;
    global.requestAnimationFrame?.(() => {
      const math = element.querySelector?.(".katex");
      if (!math || !element.clientWidth) return;
      math.style.removeProperty("font-size");
      const naturalWidth = math.getBoundingClientRect().width;
      const availableWidth = Math.max(0, element.clientWidth - 4);
      if (naturalWidth <= availableWidth) return;
      const naturalSize = Number.parseFloat(global.getComputedStyle(element).fontSize);
      const scale = Math.max(18 / naturalSize, availableWidth / naturalWidth);
      math.style.fontSize = `${scale}em`;
    });
  }

  function renderQuestion(element, expression) {
    if (!element) return false;
    const fallback = `${expression} = ?`;
    element.classList.remove("math-rendered");
    element.textContent = fallback;
    if (!global.katex?.render) return false;

    try {
      const latex = `${expressionToLatex(expression)}\\;=\\;?`;
      global.katex.render(latex, element, {
        displayMode: true,
        throwOnError: true,
        strict: "ignore",
        output: "htmlAndMathml"
      });
      element.classList.add("math-rendered");
      element.dataset.mathSource = String(expression);
      renderedElements.add(element);
      fitMathToContainer(element);
      return true;
    } catch (error) {
      console.error("[math-renderer] rendu impossible", { expression, error });
      element.textContent = fallback;
      return false;
    }
  }

  global.addEventListener?.("resize", () => {
    renderedElements.forEach(element => fitMathToContainer(element));
  });

  global.LevelingMathRenderer = {
    expressionToLatex,
    renderQuestion
  };
})(typeof window !== "undefined" ? window : globalThis);
