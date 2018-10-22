(function() {

'use strict'
var parser = window.DOMParser && new window.DOMParser()
var documentRootName = 'HTML'
var supportsHTMLType = false
var supportsInnerHTML = false
var htmlType = 'text/html'
var xhtmlType = 'application/xhtml+xml'
var testClass = 'A'
var testCode = '<wbr class="' + testClass + '"/>'

var mockDoc = document.implementation.createHTMLDocument('');
var mockHTML = mockDoc.documentElement;
var mockBody = mockDoc.body;
var bodyReg = /(<body[^>]*>)([\s\S]*)<\/body>/;

function initSetDom() {
  supportsHTMLType = false;
  supportsInnerHTML = false;
  try {
    // Check if browser supports text/html DOMParser
    var parsed = parser.parseFromString(testCode, htmlType).body.firstChild
    // Some browsers (iOS 9 and Safari 9) lowercase classes for parsed elements
    // but only when appending to DOM, so use innerHTML instead
    var d = document.createElement('div')
    d.appendChild(parsed)
    if (d.firstChild.classList[0] !== testClass) throw new Error()
    supportsHTMLType = true
  } catch (e) {}

  try {
    // Check if browser supports documentElement.innerHTML
    mockHTML.innerHTML += ''
    supportsInnerHTML = true
  } catch (e) {
    // Check if browser supports xhtml parsing.
    parser.parseFromString(testCode, xhtmlType)
  }

  var parseHTML = supportsHTMLType
  ? DOMParserParse
  : fallbackParse;

  parseHTML._testhook_initSetDom = initSetDom;

  window.parseHTML = parseHTML;
}

function DOMParserParse (markup, rootName) {
  var doc = parser.parseFromString(markup, htmlType)
  // Patch for iOS UIWebView not always returning doc.body synchronously
  if (!doc.body) { return fallbackParse(markup, rootName) }

  return rootName === documentRootName
    ? doc.documentElement
    : doc.body.firstChild
}

function fallbackParse (markup, rootName) {
  // Fallback to innerHTML for other older browsers.
  if (rootName === documentRootName) {
    if (supportsInnerHTML) {
      mockHTML.innerHTML = markup
      return mockHTML
    } else {
      // IE9 does not support innerhtml at root level.
      // We get around this by parsing everything except the body as xhtml.
      var bodyMatch = markup.match(bodyReg)
      if (bodyMatch) {
        var bodyContent = bodyMatch[2]
        var startBody = bodyMatch.index + bodyMatch[1].length
        var endBody = startBody + bodyContent.length
        markup = markup.slice(0, startBody) + markup.slice(endBody)
        mockBody.innerHTML = bodyContent
      }

      var doc = parser.parseFromString(markup, xhtmlType)
      var body = doc.body
      while (mockBody.firstChild) body.appendChild(mockBody.firstChild)
      return doc.documentElement
    }
  } else {
    mockBody.innerHTML = markup
    return mockBody.firstChild
  }
}

initSetDom();

setDOM.KEY = 'data-key'
setDOM.IGNORE = 'data-ignore'
setDOM.CHECKSUM = 'data-checksum'
var KEY_PREFIX = '_set-dom-'
var NODE_MOUNTED = KEY_PREFIX + 'mounted'
var ELEMENT_TYPE = 1
var DOCUMENT_TYPE = 9
var DOCUMENT_FRAGMENT_TYPE = 11

// Expose api.
window.setDOM = setDOM;

/**
 * @description
 * Updates existing dom to match a new dom.
 *
 * @param {Node} oldNode - The html entity to update.
 * @param {String|Node} newNode - The updated html(entity).
 */
function setDOM (oldNode, newNode) {
  // Ensure a realish dom node is provided.
  assert(oldNode && oldNode.nodeType, 'You must provide a valid node to update.')

  // Alias document element with document.
  if (oldNode.nodeType === DOCUMENT_TYPE) oldNode = oldNode.documentElement

  // Document Fragments don't have attributes, so no need to look at checksums, ignored, attributes, or node replacement.
  if (newNode.nodeType === DOCUMENT_FRAGMENT_TYPE) {
    // Simply update all children (and subchildren).
    setChildNodes(oldNode, newNode)
  } else {
    // Otherwise we diff the entire old node.
    setNode(oldNode, typeof newNode === 'string'
      // If a string was provided we will parse it as dom.
      ? parseHTML(newNode, oldNode.nodeName)
      : newNode
    )
  }

  // Trigger mount events on initial set.
  if (!oldNode[NODE_MOUNTED]) {
    oldNode[NODE_MOUNTED] = true
    mount(oldNode)
  }
}

/**
 * @private
 * @description
 * Updates a specific htmlNode and does whatever it takes to convert it to another one.
 *
 * @param {Node} oldNode - The previous HTMLNode.
 * @param {Node} newNode - The updated HTMLNode.
 */
function setNode (oldNode, newNode) {
  if (oldNode.nodeType === newNode.nodeType) {
    // Handle regular element node updates.
    if (oldNode.nodeType === ELEMENT_TYPE) {
      // Checks if nodes are equal before diffing.
      if (isEqualNode(oldNode, newNode)) return
      
      // In polymer 2.x shadyRoot doesn't exist so previuos code would never use setPolymerAttributes function
      // To be compatible with Polymer 1.x and 2.x one must check for both shadowRoot and shadyRoot
      var oldNodeHasRoot = oldNode.shadowRoot || oldNode.shadyRoot;
      var newNodeHasRoot = newNode.shadowRoot || newNode.shadyRoot;
      
      if (oldNodeHasRoot && newNodeHasRoot) {
        if (oldNode.nodeName === newNode.nodeName) {
          // update attributes
          setPolymerAttributes(oldNode, newNode);
          
          setPolymerProperties(oldNode, newNode);

          // update light dom children
          setPolymerChildNodes(oldNode, newNode)

        } else {
          // replace the nodes
          oldNode.parentNode.replaceChild(newNode, dismount(oldNode))
          mount(newNode)
        }

      } else if (!oldNodeHasRoot && newNodeHasRoot || oldNodeHasRoot && !newNodeHasRoot) {
        // replace the nodes
        oldNode.parentNode.replaceChild(newNode, dismount(oldNode))
        mount(newNode)

      } else {
        // do what ever previosly was done

        // Update all children (and subchildren).
        // NOTE this branch will be executed for shadowDOM but shadowDOM childnodes will be invisible to setDOM
        setChildNodes(oldNode, newNode)

        // Update the elements attributes / tagName.
        if (oldNode.nodeName === newNode.nodeName) {
          // If we have the same nodename then we can directly update the attributes.
          setAttributes(oldNode.attributes, newNode.attributes)
        } else {
          // Otherwise clone the new node to use as the existing node.
          var newPrev = newNode.cloneNode()
          // Copy over all existing children from the original node.
          while (oldNode.firstChild) newPrev.appendChild(oldNode.firstChild)
          // Replace the original node with the new one with the right tag.
          oldNode.parentNode.replaceChild(newPrev, oldNode)
        }
      }

    } else {
      // Handle other types of node updates (text/comments/etc).
      // If both are the same type of node we can update directly.
      if (oldNode.nodeValue !== newNode.nodeValue) {
        oldNode.nodeValue = newNode.nodeValue
      }
    }
  } else {
    // we have to replace the node.
    oldNode.parentNode.replaceChild(newNode, dismount(oldNode))
    mount(newNode)
  }
}

function setPolymerAttributes(oldElt, newElt) {
  
  Array.prototype.forEach.call(oldElt.attributes, function(oldAttr, index, array) {
    if (!oldAttr) { 
      // when attribute is removed, attributes collection is shrinked but iteration counter doesn't
      // so in IE11 we get oldAttr is null
      return; 
    }
    var name = oldAttr.localName;
    var newAttr = newElt.getAttribute(name);
    if (!newAttr) { Polymer.dom(oldElt).removeAttribute(name); }
  });

  Array.prototype.forEach.call(newElt.attributes, function(newAttr) {
    var name = newAttr.localName;
    try {
      Polymer.dom(oldElt).setAttribute(name, newAttr.value);
    } catch(e) {
      console.log(e);
    }
  });
}

function setPolymerProperties(oldElt, newElt) {
  var propNames = Object.keys(oldElt.properties);
  propNames.forEach(function(pName) {
    if (oldElt.properties) {
      var propDef = oldElt.properties[pName]; 
      if (propDef && propDef.readOnly) return;
    }

    oldElt[pName] = newElt[pName];
  });
}

/**
 * @private
 * @description
 * Utility that will update one list of attributes to match another.
 *
 * @param {NamedNodeMap} oldAttributes - The previous attributes.
 * @param {NamedNodeMap} newAttributes - The updated attributes.
 */
function setAttributes (oldAttributes, newAttributes) {
  var i, a, b, ns, name

  // Remove old attributes.
  for (i = oldAttributes.length; i--;) {
    a = oldAttributes[i]
    ns = a.namespaceURI
    name = a.localName
    b = newAttributes.getNamedItemNS(ns, name)
    if (!b) oldAttributes.removeNamedItemNS(ns, name)
  }

  // Set new attributes.
  for (i = newAttributes.length; i--;) {
    a = newAttributes[i]
    ns = a.namespaceURI
    name = a.localName
    b = oldAttributes.getNamedItemNS(ns, name)
    if (!b) {
      // Add a new attribute.
      newAttributes.removeNamedItemNS(ns, name)
      oldAttributes.setNamedItemNS(a)
    } else if (b.value !== a.value) {
      // Update existing attribute.
      b.value = a.value
    }
  }
}

/**
 * @private
 * @description
 * Utility that will nodes childern to match another nodes children.
 *
 * @param {Node} oldParent - The existing parent node.
 * @param {Node} newParent - The new parent node.
 */
function setPolymerChildNodes (oldParent, newParent) {
  var checkOld, oldKey, checkNew, newKey, foundNode, keyedNodes
  var oldNode = Polymer.dom(oldParent).firstChild;
  var newNode = Polymer.dom(newParent).firstChild;
  var extra = 0

  // Extract keyed nodes from previous children and keep track of total count.
  while (oldNode) {
    extra++
    checkOld = oldNode
    oldKey = getKey(checkOld)
    oldNode = Polymer.dom(oldNode).nextSibling

    if (oldKey) {
      if (!keyedNodes) keyedNodes = {}
      keyedNodes[oldKey] = checkOld
    }
  }

  // Loop over new nodes and perform updates.
  oldNode = Polymer.dom(oldParent).firstChild
  while (newNode) {
    extra--
    checkNew = newNode
    newNode = Polymer.dom(newNode).nextSibling

    if (keyedNodes && (newKey = getKey(checkNew)) && (foundNode = keyedNodes[newKey])) {
      delete keyedNodes[newKey]
      // If we have a key and it existed before we move the previous node to the new position if needed and diff it.
      if (foundNode !== oldNode) {
        Polymer.dom(oldParent).insertBefore(foundNode, oldNode)
      } else {
        oldNode = Polymer.dom(oldNode).nextSibling
      }

      setNode(foundNode, checkNew)
    } else if (oldNode) {
      checkOld = oldNode
      oldNode = Polymer.dom(oldNode).nextSibling
      if (getKey(checkOld)) {
        // If the old child had a key we skip over it until the end.
        Polymer.dom(oldParent).insertBefore(checkNew, checkOld)
        mount(checkNew)
      } else {
        // Otherwise we diff the two non-keyed nodes.
        setNode(checkOld, checkNew)
      }
    } else {
      // Finally if there was no old node we add the new node.
      Polymer.dom(oldParent).appendChild(checkNew)
      mount(checkNew)
    }
  }

  // Remove old keyed nodes.
  for (oldKey in keyedNodes) {
    extra--
    Polymer.dom(oldParent).removeChild(dismount(keyedNodes[oldKey]))
  }

  // If we have any remaining unkeyed nodes remove them from the end.
  while (--extra >= 0) {
    Polymer.dom(oldParent).removeChild(dismount(oldParent.lastChild))
  }
}

/**
 * @private
 * @description
 * Utility that will nodes childern to match another nodes children.
 *
 * @param {Node} oldParent - The existing parent node.
 * @param {Node} newParent - The new parent node.
 */
function setChildNodes (oldParent, newParent) {
  var checkOld, oldKey, checkNew, newKey, foundNode, keyedNodes
  var oldNode = oldParent.firstChild
  var newNode = newParent.firstChild
  var extra = 0

  // Extract keyed nodes from previous children and keep track of total count.
  while (oldNode) {
    extra++
    checkOld = oldNode
    oldKey = getKey(checkOld)
    oldNode = oldNode.nextSibling

    if (oldKey) {
      if (!keyedNodes) keyedNodes = {}
      keyedNodes[oldKey] = checkOld
    }
  }

  // Loop over new nodes and perform updates.
  oldNode = oldParent.firstChild
  while (newNode) {
    extra--
    checkNew = newNode
    newNode = newNode.nextSibling

    if (keyedNodes && (newKey = getKey(checkNew)) && (foundNode = keyedNodes[newKey])) {
      delete keyedNodes[newKey]
      // If we have a key and it existed before we move the previous node to the new position if needed and diff it.
      if (foundNode !== oldNode) {
        oldParent.insertBefore(foundNode, oldNode)
      } else {
        oldNode = oldNode.nextSibling
      }

      setNode(foundNode, checkNew)
    } else if (oldNode) {
      checkOld = oldNode
      oldNode = oldNode.nextSibling
      if (getKey(checkOld)) {
        // If the old child had a key we skip over it until the end.
        oldParent.insertBefore(checkNew, checkOld)
        mount(checkNew)
      } else {
        // Otherwise we diff the two non-keyed nodes.
        setNode(checkOld, checkNew)
      }
    } else {
      // Finally if there was no old node we add the new node.
      oldParent.appendChild(checkNew)
      mount(checkNew)
    }
  }

  // Remove old keyed nodes.
  for (oldKey in keyedNodes) {
    extra--
    oldParent.removeChild(dismount(keyedNodes[oldKey]))
  }

  // If we have any remaining unkeyed nodes remove them from the end.
  while (--extra >= 0) {
    oldParent.removeChild(dismount(oldParent.lastChild))
  }
}

/**
 * @private
 * @description
 * Utility to try to pull a key out of an element.
 * Uses 'data-key' if possible and falls back to 'id'.
 *
 * @param {Node} node - The node to get the key for.
 * @return {string|void}
 */
function getKey (node) {
  if (node.nodeType !== ELEMENT_TYPE) return
  var key = node.getAttribute(setDOM.KEY) || node.id
  if (key) return KEY_PREFIX + key
}

/**
 * Checks if nodes are equal using the following by checking if
 * they are both ignored, have the same checksum, or have the
 * same contents.
 *
 * @param {Node} a - One of the nodes to compare.
 * @param {Node} b - Another node to compare.
 */
function isEqualNode (a, b) {
  return (
    // Check if both nodes are ignored.
    (isIgnored(a) && isIgnored(b)) ||
    // Check if both nodes have the same checksum.
    (getCheckSum(a) === getCheckSum(b)) ||
    // Fall back to native isEqualNode check.
    a.isEqualNode(b)
  )
}

/**
 * @private
 * @description
 * Utility to try to pull a checksum attribute from an element.
 * Uses 'data-checksum' or user specified checksum property.
 *
 * @param {Node} node - The node to get the checksum for.
 * @return {string|NaN}
 */
function getCheckSum (node) {
  return node.getAttribute(setDOM.CHECKSUM) || NaN
}

/**
 * @private
 * @description
 * Utility to try to check if an element should be ignored by the algorithm.
 * Uses 'data-ignore' or user specified ignore property.
 *
 * @param {Node} node - The node to check if it should be ignored.
 * @return {boolean}
 */
function isIgnored (node) {
  return node.getAttribute(setDOM.IGNORE) != null
}

/**
 * Dispatches a mount event for the given node and children.
 *
 * @param {Node} node - the node to mount.
 * @return {node}
 */
function mount (node) {
  return dispatch(node, 'mount')
}

/**
 * Dispatches a dismount event for the given node and children.
 *
 * @param {Node} node - the node to dismount.
 * @return {node}
 */
function dismount (node) {
  return dispatch(node, 'dismount')
}

/**
 * Recursively trigger an event for a node and it's children.
 * Only emits events for keyed nodes.
 *
 * @param {Node} node - the initial node.
 * @return {Node}
 */
function dispatch (node, type) {
  // Trigger event for this element if it has a key.
  if (getKey(node)) {
    var ev = document.createEvent('Event')
    var prop = { value: node }
    ev.initEvent(type, false, false)
    Object.defineProperty(ev, 'target', prop)
    Object.defineProperty(ev, 'srcElement', prop)
    node.dispatchEvent(ev)
  }

  // Dispatch to all children.
  var child = node.firstChild
  while (child) child = dispatch(child, type).nextSibling
  return node
}

/**
 * @private
 * @description
 * Confirm that a value is truthy, throws an error message otherwise.
 *
 * @param {*} val - the val to test.
 * @param {string} msg - the error message on failure.
 * @throws {Error}
 */
function assert (val, msg) {
  if (!val) throw new Error('set-dom: ' + msg)
}

}());
