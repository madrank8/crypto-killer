'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import ImageExt from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { useEffect, useCallback, useState } from 'react';

/* ─── Toolbar Button ─── */
function TBtn({ label, isActive, onClick, disabled }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1.5 rounded text-xs font-semibold transition ${
        isActive
          ? 'bg-brand-green text-black'
          : 'text-gray-300 hover:bg-gray-600 hover:text-white'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
      title={label}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-6 bg-gray-600 mx-0.5" />;
}

/* ─── HTML Preview Pane ───
   Renders the full article HTML with dangerouslySetInnerHTML so visuals
   (charts, diagrams, DALL-E images) display exactly as they do on the public page.
*/
function HtmlPreview({ html }) {
  return (
    <div
      className="min-h-[500px] p-6 prose prose-invert prose-slate max-w-none text-gray-200
        [&_figure]:my-6 [&_figure]:text-center
        [&_figcaption]:text-slate-400 [&_figcaption]:text-sm [&_figcaption]:mt-2
        [&_img]:rounded-xl [&_img]:border [&_img]:border-slate-700 [&_img]:mx-auto [&_img]:max-w-full
        [&_.article-hero-image]:mb-8 [&_.article-hero-image_img]:w-full [&_.article-hero-image_img]:h-auto
        [&_.article-content-image]:my-8 [&_.article-content-image_img]:w-full [&_.article-content-image_img]:h-auto
        [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:text-white [&_h1]:mt-10 [&_h1]:mb-4
        [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-white [&_h2]:mt-10 [&_h2]:mb-4
        [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-white [&_h3]:mt-8 [&_h3]:mb-3
        [&_p]:mb-4 [&_p]:text-slate-300 [&_p]:leading-relaxed
        [&_a]:text-brand-green [&_a]:underline
        [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4
        [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4
        [&_li]:mb-1 [&_li]:text-slate-300
        [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-500 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-slate-400"
      dangerouslySetInnerHTML={{ __html: html || '<p class="text-gray-600 italic">No content yet — generate or write your article above.</p>' }}
    />
  );
}

/* ─── Source Code Editor ─── */
function SourceEditor({ html, onChange }) {
  return (
    <textarea
      value={html}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-h-[500px] p-4 bg-dark-bg border-0 font-mono text-sm text-gray-200 focus:outline-none resize-y"
      spellCheck={false}
    />
  );
}

/* ─── View Mode Toggle ─── */
function ViewToggle({ mode, setMode, hasVisuals }) {
  const modes = [
    { key: 'edit', label: 'Edit' },
    { key: 'preview', label: 'Preview', highlight: hasVisuals },
    { key: 'source', label: 'HTML' },
  ];
  return (
    <div className="flex gap-0.5 p-1 bg-gray-800 rounded-lg">
      {modes.map((m) => (
        <button
          key={m.key}
          type="button"
          onClick={() => setMode(m.key)}
          className={`px-3 py-1 text-xs font-medium rounded-md transition relative ${
            mode === m.key
              ? 'bg-gray-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {m.label}
          {m.highlight && mode !== m.key && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          )}
        </button>
      ))}
    </div>
  );
}

/* ─── Main Component ─── */
export default function TipTapEditor({ content, onChange, placeholder, showViewToggle = true }) {
  const hasVisuals = content && typeof content === 'string' && content.includes('ck-visual');
  const [viewMode, setViewMode] = useState(hasVisuals ? 'preview' : 'edit');

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: 'text-brand-green underline' },
      }),
      ImageExt.configure({
        HTMLAttributes: { class: 'max-w-full rounded my-3' },
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder: placeholder || 'Start writing your review...',
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content: content || '',
    editorProps: {
      attributes: {
        class: 'min-h-[500px] p-4 focus:outline-none prose prose-invert max-w-none text-gray-200',
      },
    },
    onUpdate: ({ editor }) => {
      if (viewMode === 'edit') {
        onChange(editor.getHTML());
      }
    },
  });

  // Update content from outside (e.g. AI generate)
  useEffect(() => {
    if (editor && content !== undefined) {
      const currentHTML = editor.getHTML();
      if (content !== currentHTML && content !== '') {
        editor.commands.setContent(content, false);
        // If the new content has visuals, auto-switch to preview
        if (content.includes('ck-visual') && viewMode === 'edit') {
          setViewMode('preview');
        }
      }
    }
  }, [content, editor]);

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden bg-dark-bg">
      {/* Header with toolbar + toggle */}
      <div className="flex items-center justify-between p-2 bg-dark-surface border-b border-gray-700 gap-2">
        {viewMode === 'edit' && editor ? (
          <div className="flex flex-wrap items-center gap-0.5 flex-1 min-w-0">
            <TBtn label="B" isActive={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
            <TBtn label="I" isActive={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <TBtn label="U" isActive={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
            <TBtn label="S" isActive={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
            <Divider />
            <TBtn label="H2" isActive={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
            <TBtn label="H3" isActive={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
            <Divider />
            <TBtn label="• List" isActive={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
            <TBtn label="1. List" isActive={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
            <Divider />
            <TBtn label="Quote" isActive={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
            <TBtn label="🔗" isActive={editor.isActive('link')} onClick={() => {
              const prev = editor.getAttributes('link').href;
              const url = prompt('URL:', prev || 'https://');
              if (url === null) return;
              if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
              else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            }} />
            <TBtn label="🖼" onClick={() => {
              const url = prompt('Image URL:');
              if (url) editor.chain().focus().setImage({ src: url }).run();
            }} />
            <Divider />
            <TBtn label="↩" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
            <TBtn label="↪" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />
          </div>
        ) : (
          <div className="flex-1 min-w-0">
            <span className="text-xs text-gray-500 px-1">
              {viewMode === 'preview'
                ? (hasVisuals ? '👁 Preview — charts, diagrams, and images rendered below' : '👁 Rendered preview')
                : '< > Raw HTML source — edit directly'}
            </span>
          </div>
        )}

        {showViewToggle && (
          <div className="flex-shrink-0">
            <ViewToggle mode={viewMode} setMode={setViewMode} hasVisuals={hasVisuals} />
          </div>
        )}
      </div>

      {/* Content area */}
      {viewMode === 'edit' && <EditorContent editor={editor} />}
      {viewMode === 'preview' && <HtmlPreview html={content} />}
      {viewMode === 'source' && <SourceEditor html={content} onChange={onChange} />}
    </div>
  );
}
