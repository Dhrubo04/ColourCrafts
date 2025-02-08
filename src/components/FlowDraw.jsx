import React, { useState, useRef, useEffect } from 'react';
import { Analytics } from "@vercel/analytics/react";
import {
  Square,
  Circle,
  MousePointer,
  Trash2,
  Download,
  Edit3,
  Undo,
  Redo,
  Plus,
  Minus,
  ArrowRight,
  Triangle,
  Eraser
} from 'lucide-react';
import { Navbar, Container, Button, Form, OverlayTrigger, Tooltip } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import './FlowDraw.css';

const FlowDraw = () => {
  const [tool, setTool] = useState('select');
  const [elements, setElements] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [currentElement, setCurrentElement] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef(null);
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [zoomLevel, setZoomLevel] = useState(1);
  // History: past, present, future
  const [history, setHistory] = useState({ past: [], present: [], future: [] });
  // Text editing state. When visible, an input is rendered.
  const [editingText, setEditingText] = useState({ visible: false, x: 0, y: 0, text: '', fontSize: 16 });
  
  // For resizing the selected element.
  const [resizeData, setResizeData] = useState({
    resizing: false,
    handle: null,
    startX: 0,
    startY: 0,
    originalElement: null,
    originalBBox: null,
  });

  // Fixed navbar height (in pixels)
  const NAVBAR_HEIGHT = 80;
  const [canvasSize, setCanvasSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight - NAVBAR_HEIGHT,
  });

  useEffect(() => {
    const handleResize = () => {
      setCanvasSize({
        width: window.innerWidth,
        height: window.innerHeight - NAVBAR_HEIGHT,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Helper: draw a rounded rectangle.
  const drawRoundedRect = (ctx, x, y, width, height, radius) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.stroke();
  };

  // Compute bounding box for an element.
  const computeBoundingBox = (element) => {
    if (element.type === 'text') {
      const fontSize = element.fontSize || 16;
      const approxWidth = element.text.length * fontSize * 0.6;
      return { minX: element.x, minY: element.y - fontSize, maxX: element.x + approxWidth, maxY: element.y };
    } else if (element.points) {
      const xs = element.points.map(p => p.x);
      const ys = element.points.map(p => p.y);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    } else if (element.type === 'arrow' || element.type === 'line') {
      return {
        minX: Math.min(element.x1, element.x2),
        minY: Math.min(element.y1, element.y2),
        maxX: Math.max(element.x1, element.x2),
        maxY: Math.max(element.y1, element.y2)
      };
    }
    return null;
  };

  // Scale an element based on a new dragged handle position.
  const scaleElement = (originalElement, originalBBox, handle, newCorner) => {
    let fixedCorner;
    if (handle === 'top-left') {
      fixedCorner = { x: originalBBox.maxX, y: originalBBox.maxY };
    } else if (handle === 'top-right') {
      fixedCorner = { x: originalBBox.minX, y: originalBBox.maxY };
    } else if (handle === 'bottom-left') {
      fixedCorner = { x: originalBBox.maxX, y: originalBBox.minY };
    } else if (handle === 'bottom-right') {
      fixedCorner = { x: originalBBox.minX, y: originalBBox.minY };
    }
    const oldWidth = originalBBox.maxX - originalBBox.minX;
    const oldHeight = originalBBox.maxY - originalBBox.minY;
    const newWidth = Math.abs(newCorner.x - fixedCorner.x);
    const newHeight = Math.abs(newCorner.y - fixedCorner.y);
    const scaleX = newWidth / oldWidth;
    const scaleY = newHeight / oldHeight;
    let newElement = { ...originalElement };
    if (originalElement.points) {
      newElement.points = originalElement.points.map(p => ({
        x: fixedCorner.x + (p.x - fixedCorner.x) * scaleX,
        y: fixedCorner.y + (p.y - fixedCorner.y) * scaleY,
      }));
    } else if (originalElement.type === 'arrow' || originalElement.type === 'line') {
      newElement.x1 = fixedCorner.x + (originalElement.x1 - fixedCorner.x) * scaleX;
      newElement.y1 = fixedCorner.y + (originalElement.y1 - fixedCorner.y) * scaleY;
      newElement.x2 = fixedCorner.x + (originalElement.x2 - fixedCorner.x) * scaleX;
      newElement.y2 = fixedCorner.y + (originalElement.y2 - fixedCorner.y) * scaleY;
    } else if (originalElement.type === 'text') {
      newElement.x = fixedCorner.x + (originalElement.x - fixedCorner.x) * scaleX;
      newElement.y = fixedCorner.y + (originalElement.y - fixedCorner.y) * scaleY;
      newElement.fontSize = originalElement.fontSize * ((scaleX + scaleY) / 2);
    }
    return newElement;
  };

  const finalizeAction = (newElements) => {
    setHistory(prev => ({
      past: [...prev.past, prev.present],
      present: newElements,
      future: []
    }));
    setElements(newElements);
  };

  const undo = () => {
    setHistory(prev => {
      if (prev.past.length === 0) return prev;
      const newFuture = [prev.present, ...prev.future];
      const newPresent = prev.past[prev.past.length - 1];
      const newPast = prev.past.slice(0, -1);
      setElements(newPresent);
      return { past: newPast, present: newPresent, future: newFuture };
    });
  };

  const redo = () => {
    setHistory(prev => {
      if (prev.future.length === 0) return prev;
      const newPast = [...prev.past, prev.present];
      const newPresent = prev.future[0];
      const newFuture = prev.future.slice(1);
      setElements(newPresent);
      return { past: newPast, present: newPresent, future: newFuture };
    });
  };

  // Return the index of the element under (x,y).
  const getElementAtPosition = (x, y) => {
    const tolerance = 5;
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el.type === 'rectangle' || el.type === 'freehand') {
        const xs = el.points.map(p => p.x);
        const ys = el.points.map(p => p.y);
        const minX = Math.min(...xs) - tolerance;
        const maxX = Math.max(...xs) + tolerance;
        const minY = Math.min(...ys) - tolerance;
        const maxY = Math.max(...ys) + tolerance;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) return i;
      } else if (el.type === 'circle') {
        const center = el.points[0];
        const last = el.points[el.points.length - 1];
        const radius = Math.hypot(last.x - center.x, last.y - center.y);
        if (Math.hypot(x - center.x, y - center.y) <= radius + tolerance) return i;
      } else if (el.type === 'arrow' || el.type === 'line') {
        const { x1, y1, x2, y2 } = el;
        const minX = Math.min(x1, x2) - tolerance;
        const maxX = Math.max(x1, x2) + tolerance;
        const minY = Math.min(y1, y2) - tolerance;
        const maxY = Math.max(y1, y2) + tolerance;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) return i;
      } else if (el.type === 'roundedRectangle') {
        const { points } = el;
        const minX = Math.min(points[0].x, points[points.length - 1].x) - tolerance;
        const maxX = Math.max(points[0].x, points[points.length - 1].x) + tolerance;
        const minY = Math.min(points[0].y, points[points.length - 1].y) - tolerance;
        const maxY = Math.max(points[0].y, points[points.length - 1].y) + tolerance;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) return i;
      } else if (el.type === 'triangle') {
        const xs = el.points.map(p => p.x);
        const ys = el.points.map(p => p.y);
        const minX = Math.min(...xs) - tolerance;
        const maxX = Math.max(...xs) + tolerance;
        const minY = Math.min(...ys) - tolerance;
        const maxY = Math.max(...ys) + tolerance;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) return i;
      } else if (el.type === 'text') {
        const fontSize = el.fontSize || 16;
        const approxWidth = el.text.length * fontSize * 0.6;
        if (x >= el.x && x <= el.x + approxWidth && y >= el.y - fontSize && y <= el.y) return i;
      }
    }
    return null;
  };

  // Update an element’s position for dragging.
  const updateElementPosition = (index, dx, dy) => {
    setElements(prev => {
      const newElements = [...prev];
      const el = newElements[index];
      if (el.type === 'rectangle' || el.type === 'freehand' || el.type === 'circle' || el.type === 'roundedRectangle') {
        el.points = el.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      } else if (el.type === 'arrow' || el.type === 'line') {
        el.x1 += dx;
        el.y1 += dy;
        el.x2 += dx;
        el.y2 += dy;
      } else if (el.type === 'triangle') {
        el.points = el.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      } else if (el.type === 'text') {
        el.x += dx;
        el.y += dy;
      }
      newElements[index] = { ...el };
      return newElements;
    });
  };

  // Draw an element (finalized or live preview).
  const drawElement = (ctx, element) => {
    ctx.beginPath();
    ctx.strokeStyle = element.color;
    ctx.lineWidth = element.strokeWidth;
    switch (element.type) {
      case 'rectangle': {
        const { points } = element;
        const width = points[points.length - 1].x - points[0].x;
        const height = points[points.length - 1].y - points[0].y;
        ctx.rect(points[0].x, points[0].y, width, height);
        break;
      }
      case 'circle': {
        const { points } = element;
        const radius = Math.hypot(points[points.length - 1].x - points[0].x, points[points.length - 1].y - points[0].y);
        ctx.arc(points[0].x, points[0].y, radius, 0, 2 * Math.PI);
        break;
      }
      case 'freehand': {
        const { points } = element;
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach(point => ctx.lineTo(point.x, point.y));
        break;
      }
      case 'arrow': {
        const { x1, y1, x2, y2 } = element;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        const arrowSize = 10;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - arrowSize * Math.cos(angle - Math.PI / 6), y2 - arrowSize * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - arrowSize * Math.cos(angle + Math.PI / 6), y2 - arrowSize * Math.sin(angle + Math.PI / 6));
        break;
      }
      case 'line': {
        ctx.moveTo(element.x1, element.y1);
        ctx.lineTo(element.x2, element.y2);
        break;
      }
      case 'roundedRectangle': {
        const { points } = element;
        const x = points[0].x;
        const y = points[0].y;
        const width = points[points.length - 1].x - x;
        const height = points[points.length - 1].y - y;
        drawRoundedRect(ctx, x, y, width, height, 10);
        return;
      }
      case 'triangle': {
        const { points } = element;
        const x1 = Math.min(points[0].x, points[points.length - 1].x);
        const y1 = Math.min(points[0].y, points[points.length - 1].y);
        const x2 = Math.max(points[0].x, points[points.length - 1].x);
        const y2 = Math.max(points[0].y, points[points.length - 1].y);
        const midX = (x1 + x2) / 2;
        ctx.moveTo(midX, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x1, y2);
        ctx.closePath();
        break;
      }
      case 'text': {
        const fontSize = element.fontSize || 16;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = element.color;
        ctx.fillText(element.text, element.x, element.y);
        return;
      }
      default:
        break;
    }
    ctx.stroke();
  };

  // --- Selection & Resizing ---
  const selectElement = (e) => {
    const { offsetX, offsetY } = e.nativeEvent;
    const index = getElementAtPosition(offsetX, offsetY);
    if (index !== null) {
      setSelectedIndex(index);
      setDragStart({ x: offsetX, y: offsetY });
      setIsDragging(true);
    }
  };

  // --- Eraser ---
  const handleEraser = (e) => {
    const { offsetX, offsetY } = e.nativeEvent;
    const index = getElementAtPosition(offsetX, offsetY);
    if (index !== null) {
      const newElements = elements.filter((_, i) => i !== index);
      finalizeAction(newElements);
    }
  };

  // --- Resizing Handlers ---
  const checkForResizeHandle = (e) => {
    if (selectedIndex === null) return false;
    const element = elements[selectedIndex];
    const bbox = computeBoundingBox(element);
    const handles = {
      'top-left': { x: bbox.minX, y: bbox.minY },
      'top-right': { x: bbox.maxX, y: bbox.minY },
      'bottom-left': { x: bbox.minX, y: bbox.maxY },
      'bottom-right': { x: bbox.maxX, y: bbox.maxY },
    };
    const threshold = 8;
    const { offsetX, offsetY } = e.nativeEvent;
    for (let key in handles) {
      const handlePos = handles[key];
      if (Math.abs(offsetX - handlePos.x) < threshold && Math.abs(offsetY - handlePos.y) < threshold) {
        setResizeData({
          resizing: true,
          handle: key,
          startX: offsetX,
          startY: offsetY,
          originalElement: JSON.parse(JSON.stringify(element)),
          originalBBox: bbox,
        });
        return true;
      }
    }
    return false;
  };

  const handleSelectMove = (e) => {
    if (!isDragging) return;
    const { offsetX, offsetY } = e.nativeEvent;
    const dx = offsetX - dragStart.x;
    const dy = offsetY - dragStart.y;
    if (selectedIndex !== null) {
      updateElementPosition(selectedIndex, dx, dy);
      setDragStart({ x: offsetX, y: offsetY });
    }
  };

  const endSelect = () => {
    setIsDragging(false);
    setSelectedIndex(null);
  };

  // --- Mouse Events for Drawing ---
  const handleMouseDown = (e) => {
    const { offsetX, offsetY } = e.nativeEvent;
    if (tool === 'arrow') {
      setCurrentElement({ type: 'arrow', x1: offsetX, y1: offsetY, x2: offsetX, y2: offsetY, color, strokeWidth });
    } else if (tool === 'rectangle') {
      setCurrentElement({ type: 'rectangle', points: [{ x: offsetX, y: offsetY }], color, strokeWidth });
    } else if (tool === 'circle') {
      setCurrentElement({ type: 'circle', points: [{ x: offsetX, y: offsetY }], color, strokeWidth });
    } else if (tool === 'freehand') {
      setCurrentElement({ type: 'freehand', points: [{ x: offsetX, y: offsetY }], color, strokeWidth });
    } else if (tool === 'roundedRectangle') {
      setCurrentElement({ type: 'roundedRectangle', points: [{ x: offsetX, y: offsetY }], color, strokeWidth });
    } else if (tool === 'triangle') {
      setCurrentElement({ type: 'triangle', points: [{ x: offsetX, y: offsetY }], color, strokeWidth });
    } else if (tool === 'line') {
      setCurrentElement({ type: 'line', x1: offsetX, y1: offsetY, x2: offsetX, y2: offsetY, color, strokeWidth });
    }
    setIsDrawing(true);
  };

  const handleMouseMove = (e) => {
    if (resizeData.resizing) {
      const newCorner = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
      const newElement = scaleElement(
        resizeData.originalElement,
        resizeData.originalBBox,
        resizeData.handle,
        newCorner
      );
      setElements(prev => {
        const newEls = [...prev];
        newEls[selectedIndex] = newElement;
        return newEls;
      });
      return;
    }
    if (!isDrawing) return;
    const { offsetX, offsetY } = e.nativeEvent;
    if (tool === 'arrow' || tool === 'line') {
      setCurrentElement(prev => ({ ...prev, x2: offsetX, y2: offsetY }));
    } else if (tool === 'rectangle' || tool === 'circle' || tool === 'freehand' || tool === 'roundedRectangle' || tool === 'triangle') {
      setCurrentElement(prev => {
        if (!prev) return null;
        const updatedElement = { ...prev, points: [...prev.points, { x: offsetX, y: offsetY }] };
        setElements(els => els.map(el => (el === prev ? updatedElement : el)));
        return updatedElement;
      });
    }
  };

  const handleMouseUp = (e) => {
    if (resizeData.resizing) {
      finalizeAction(elements);
      setResizeData({
        resizing: false,
        handle: null,
        startX: 0,
        startY: 0,
        originalElement: null,
        originalBBox: null,
      });
      return;
    }
    if (!isDrawing) return;
    if (tool !== 'text') {
      const newElements = [...elements, currentElement];
      finalizeAction(newElements);
      setCurrentElement(null);
    }
    setIsDrawing(false);
  };

  // --- Touch Event Helpers ---
  const getTouchEventData = (e) => {
    // Prevent scrolling when touching the canvas.
    e.preventDefault();
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0] || e.changedTouches[0];
    return { nativeEvent: { offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top } };
  };

  const handleTouchStart = (e) => {
    const syntheticEvent = getTouchEventData(e);
    handleCanvasMouseDown(syntheticEvent);
  };

  const handleTouchMove = (e) => {
    const syntheticEvent = getTouchEventData(e);
    handleCanvasMouseMove(syntheticEvent);
  };

  const handleTouchEnd = (e) => {
    // Use changedTouches for touchend.
    const syntheticEvent = getTouchEventData(e);
    handleCanvasMouseUp(syntheticEvent);
  };

  // --- Canvas Mouse/Touch Events ---
  const handleCanvasMouseDown = (e) => {
    if (tool === 'eraser') {
      handleEraser(e);
      return;
    }
    if (tool === 'select') {
      if (checkForResizeHandle(e)) return;
      selectElement(e);
    } else if (tool === 'text') {
      const { offsetX, offsetY } = e.nativeEvent;
      setEditingText({ visible: true, x: offsetX, y: offsetY, text: '', fontSize: 16 });
      return;
    } else {
      handleMouseDown(e);
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (tool === 'select' && isDragging) {
      handleSelectMove(e);
    } else {
      handleMouseMove(e);
    }
  };

  const handleCanvasMouseUp = (e) => {
    if (tool === 'select') {
      endSelect();
    } else {
      handleMouseUp(e);
    }
  };

  // --- Text Editing ---
  const handleTextChange = (e) => {
    setEditingText({ ...editingText, text: e.target.value });
  };

  const handleTextKeyDown = (e) => {
    if (e.key === 'Enter') {
      const newTextElement = {
        type: 'text',
        x: editingText.x,
        y: editingText.y,
        text: editingText.text,
        color,
        fontSize: editingText.fontSize,
      };
      finalizeAction([...elements, newTextElement]);
      setEditingText({ visible: false, x: 0, y: 0, text: '', fontSize: 16 });
    } else if (e.key === 'Escape') {
      setEditingText({ visible: false, x: 0, y: 0, text: '', fontSize: 16 });
    }
  };

  const clearCanvas = () => {
    setElements([]);
    setHistory({ past: [], present: [], future: [] });
  };

  const downloadCanvas = () => {
    const canvas = canvasRef.current;
    const dataURL = canvas.toDataURL();
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = 'drawing.png';
    link.click();
  };

  const zoomIn = () => {
    setZoomLevel(prevZoom => Math.min(prevZoom + 0.1, 2));
  };

  const zoomOut = () => {
    setZoomLevel(prevZoom => Math.max(prevZoom - 0.1, 0.5));
  };

  // --- Render on Canvas ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(zoomLevel, zoomLevel);
    
    // Draw finalized elements.
    elements.forEach(element => {
      drawElement(ctx, element);
    });
    
    // Draw live (current) element with dotted overlay and handles.
    if (currentElement && tool !== 'text') {
      drawElement(ctx, currentElement);
      const bbox = computeBoundingBox(currentElement);
      if (bbox) {
        ctx.save();
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = 'black';
        ctx.strokeRect(bbox.minX, bbox.minY, bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
        ctx.setLineDash([]);
        const handleSize = 6;
        const handles = [
          { x: bbox.minX, y: bbox.minY },
          { x: bbox.maxX, y: bbox.minY },
          { x: bbox.minX, y: bbox.maxY },
          { x: bbox.maxX, y: bbox.maxY },
        ];
        handles.forEach(h => {
          ctx.beginPath();
          ctx.fillStyle = 'white';
          ctx.strokeStyle = 'black';
          ctx.arc(h.x, h.y, handleSize, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        });
        ctx.restore();
      }
    }
    
    // Draw selection overlay for the selected element.
    if (selectedIndex !== null) {
      const element = elements[selectedIndex];
      const bbox = computeBoundingBox(element);
      if (bbox) {
        ctx.save();
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = 'black';
        ctx.strokeRect(bbox.minX, bbox.minY, bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
        ctx.setLineDash([]);
        const handleSize = 6;
        const handles = [
          { x: bbox.minX, y: bbox.minY },
          { x: bbox.maxX, y: bbox.minY },
          { x: bbox.minX, y: bbox.maxY },
          { x: bbox.maxX, y: bbox.maxY },
        ];
        handles.forEach(h => {
          ctx.beginPath();
          ctx.fillStyle = 'white';
          ctx.strokeStyle = 'black';
          ctx.arc(h.x, h.y, handleSize, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        });
        ctx.restore();
      }
    }
    
    ctx.restore();
  }, [elements, currentElement, zoomLevel, canvasSize, selectedIndex, resizeData, tool]);

  const renderTooltip = (props) => (
    <Tooltip id="button-tooltip" {...props}>
      {props.children}
    </Tooltip>
  );

  return (
    <div className="vh-100 d-flex flex-column mauve-bg" style={{ position: 'relative' }}>
      {/* Fixed Navbar at the top */}
      <Navbar fixed="top" bg="mauve" expand="lg" className="border-bottom mauve-navbar">
        <Container fluid>
          <Navbar.Brand className="fw-bold text-white cursive-font">ColourCrafts</Navbar.Brand>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Select Tool" })}>
              <Button variant={tool === 'select' ? 'primary' : 'outline-mauve'} onClick={() => setTool('select')}>
                <MousePointer size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Rectangle Tool" })}>
              <Button variant={tool === 'rectangle' ? 'primary' : 'outline-mauve'} onClick={() => setTool('rectangle')}>
                <Square size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Circle Tool" })}>
              <Button variant={tool === 'circle' ? 'primary' : 'outline-mauve'} onClick={() => setTool('circle')}>
                <Circle size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Freehand Tool" })}>
              <Button variant={tool === 'freehand' ? 'primary' : 'outline-mauve'} onClick={() => setTool('freehand')}>
                <Edit3 size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Arrow Tool" })}>
              <Button variant={tool === 'arrow' ? 'primary' : 'outline-mauve'} onClick={() => setTool('arrow')}>
                <ArrowRight size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Line Tool" })}>
              <Button variant={tool === 'line' ? 'primary' : 'outline-mauve'} onClick={() => setTool('line')}>
                <span style={{ fontWeight: 'bold' }}>L</span>
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Rounded Square Tool" })}>
              <Button variant={tool === 'roundedRectangle' ? 'primary' : 'outline-mauve'} onClick={() => setTool('roundedRectangle')}>
                <Square size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Triangle Tool" })}>
              <Button variant={tool === 'triangle' ? 'primary' : 'outline-mauve'} onClick={() => setTool('triangle')}>
                <Triangle size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Text Tool" })}>
              <Button variant={tool === 'text' ? 'primary' : 'outline-mauve'} onClick={() => setTool('text')}>
                <span style={{ fontWeight: 'bold', fontSize: '20px' }}>T</span>
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Eraser Tool" })}>
              <Button variant={tool === 'eraser' ? 'primary' : 'outline-mauve'} onClick={() => setTool('eraser')}>
                <Eraser size={20} />
              </Button>
            </OverlayTrigger>
            <Form.Control
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: '50px', border: '1px solid #D0A8E2' }}
            />
            <Form.Range
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
              min="1"
              max="20"
              style={{ width: '150px' }}
            />
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Undo" })}>
              <Button variant="outline-mauve" onClick={undo} disabled={history.past.length === 0}>
                <Undo size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Redo" })}>
              <Button variant="outline-mauve" onClick={redo} disabled={history.future.length === 0}>
                <Redo size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Zoom In" })}>
              <Button variant="outline-mauve" onClick={zoomIn}>
                <Plus size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Zoom Out" })}>
              <Button variant="outline-mauve" onClick={zoomOut}>
                <Minus size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Clear Canvas" })}>
              <Button variant="outline-mauve" onClick={clearCanvas}>
                <Trash2 size={20} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger placement="bottom" overlay={renderTooltip({ children: "Download Image" })}>
              <Button variant="outline-mauve" onClick={downloadCanvas}>
                <Download size={20} />
              </Button>
            </OverlayTrigger>
          </div>
        </Container>
      </Navbar>
      {/* Canvas container */}
      <div className="flex-grow-1 position-relative canvas-area">
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ 
            cursor: tool === 'select' ? 'default' : 'crosshair',
            border: '1px solid lightgray',
            touchAction: 'none'  // Prevents default scrolling on touch devices.
          }}
          className="bg-white canvas"
        />
        {editingText.visible && (
          <input
            type="text"
            value={editingText.text}
            onChange={handleTextChange}
            onKeyDown={handleTextKeyDown}
            onBlur={() => {
              const newTextElement = {
                type: 'text',
                x: editingText.x,
                y: editingText.y,
                text: editingText.text,
                color,
                fontSize: editingText.fontSize,
              };
              finalizeAction([...elements, newTextElement]);
              setEditingText({ visible: false, x: 0, y: 0, text: '', fontSize: 16 });
            }}
            autoFocus
            style={{
              position: 'absolute',
              left: editingText.x,
              top: editingText.y,
              font: `${editingText.fontSize}px sans-serif`,
              border: '1px solid #D0A8E2',
              zIndex: 1000,
              backgroundColor: 'white',
              padding: '2px'
            }}
          />
        )}
      </div>
    </div>
  );
};

export default FlowDraw;
