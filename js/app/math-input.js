(function initializeMathInput(global) {
  "use strict";

  function findClosingParenthesis(source, start) {
    let depth = 0;
    for (let index = start; index < source.length; index++) {
      if (source[index] === "(") depth++;
      if (source[index] === ")" && --depth === 0) return index;
    }
    return -1;
  }

  function isNumericAtom(value) {
    if (!value) return false;
    let index = 0;
    if (value[index] === "+" || value[index] === "-") index++;
    let digitCount = 0;
    let separatorCount = 0;
    for (; index < value.length; index++) {
      const character = value[index];
      if (character >= "0" && character <= "9") {
        digitCount++;
      } else if ((character === "." || character === ",") && separatorCount === 0) {
        separatorCount++;
      } else {
        return false;
      }
    }
    return digitCount > 0;
  }

  // MathLive serializes simple fractions as (1)/(2). The current validators
  // expect 1/2, so only redundant parentheses around numeric atoms are removed.
  function unwrapNumericFractionAtoms(source) {
    let result = "";
    for (let index = 0; index < source.length;) {
      if (source[index] !== "(") {
        result += source[index++];
        continue;
      }
      const closingIndex = findClosingParenthesis(source, index);
      if (closingIndex < 0) {
        result += source.slice(index);
        break;
      }
      const content = source.slice(index + 1, closingIndex);
      const previousCharacter = result[result.length - 1] || "";
      const nextCharacter = source[closingIndex + 1] || "";
      if (isNumericAtom(content) && (previousCharacter === "/" || nextCharacter === "/")) {
        result += content;
      } else {
        result += source.slice(index, closingIndex + 1);
      }
      index = closingIndex + 1;
    }
    return result;
  }

  function toValidatorText(asciiMath) {
    return unwrapNumericFractionAtoms(String(asciiMath ?? "").replace(/\s+/g, ""));
  }

  function createNativeInputAdapter(originalControl) {
    let control = originalControl;
    if (control?.tagName !== "INPUT") {
      const fallback = global.document.createElement("input");
      fallback.type = "text";
      fallback.id = control?.id || "answerInput";
      fallback.className = control?.className || "";
      fallback.placeholder = "Ta réponse";
      fallback.autocomplete = "off";
      fallback.inputMode = "none";
      control?.replaceWith(fallback);
      control = fallback;
    }
    return {
      get value() { return control.value; },
      set value(value) { control.value = value; },
      get disabled() { return control.disabled; },
      set disabled(value) { control.disabled = value; },
      get classList() { return control.classList; },
      addEventListener(...args) { return control.addEventListener(...args); },
      focus() { control.focus(); },
      insertText(text) {
        const start = control.selectionStart ?? control.value.length;
        const end = control.selectionEnd ?? control.value.length;
        control.value = control.value.slice(0, start) + text + control.value.slice(end);
        const nextPosition = start + text.length;
        control.setSelectionRange(nextPosition, nextPosition);
      },
      insertPowerTemplate() { this.insertText("x^"); },
      deleteBackward() {
        const start = control.selectionStart ?? control.value.length;
        const end = control.selectionEnd ?? start;
        const deleteStart = start === end ? Math.max(0, start - 1) : start;
        control.value = control.value.slice(0, deleteStart) + control.value.slice(end);
        control.setSelectionRange(deleteStart, deleteStart);
      },
      getLatex() { return control.value; },
      get element() { return control; }
    };
  }

  function createAdapter(control) {
    if (!control || typeof control.getValue !== "function") {
      console.warn("[math-input] MathLive indisponible, saisie texte conservée.");
      return createNativeInputAdapter(control);
    }

    control.placeholder = "\\text{Ta réponse}";
    control.mathVirtualKeyboardPolicy = "manual";
    control.smartFence = true;
    control.smartSuperscript = true;

    return {
      get value() { return toValidatorText(control.getValue("ascii-math")); },
      set value(value) {
        if (!value) {
          control.setValue("");
          return;
        }
        const latex = global.MathLive?.convertAsciiMathToLatex?.(String(value)) || String(value);
        control.setValue(latex);
      },
      get disabled() { return control.disabled; },
      set disabled(value) { control.disabled = Boolean(value); },
      get classList() { return control.classList; },
      addEventListener(...args) { return control.addEventListener(...args); },
      focus() { control.focus(); },
      insertText(text) {
        control.executeCommand(["typedText", String(text), {
          focus: false,
          feedback: false,
          simulateKeystroke: true
        }]);
      },
      insertPowerTemplate() {
        control.insert("x^{\\placeholder{}}", {
          insertionMode: "replaceSelection",
          selectionMode: "placeholder",
          focus: true,
          feedback: false,
          scrollIntoView: false
        });
      },
      deleteBackward() { control.executeCommand("delete-backward"); },
      getLatex() { return control.getValue("latex"); },
      get element() { return control; }
    };
  }

  global.LevelingMathInput = {
    createAdapter,
    toValidatorText,
    unwrapNumericFractionAtoms
  };
})(typeof window !== "undefined" ? window : globalThis);
