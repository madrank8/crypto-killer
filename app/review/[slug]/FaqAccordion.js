'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

export default function FaqAccordion({ items }) {
  const [openIndex, setOpenIndex] = useState(null)

  if (!items || items.length === 0) {
    return null
  }

  return (
    <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
      {items.map((item, index) => (
        <div key={index} className="bg-slate-900/50">
          <button
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
            className="w-full text-left flex items-center justify-between gap-4 p-5 hover:bg-slate-800/40 transition-colors"
          >
            <h3 className="font-semibold text-white text-sm">
              {item.question}
            </h3>
            {openIndex === index ? (
              <ChevronUp size={18} className="text-slate-400 flex-shrink-0" />
            ) : (
              <ChevronDown size={18} className="text-slate-400 flex-shrink-0" />
            )}
          </button>

          {openIndex === index && (
            <div className="px-5 pb-5 text-slate-400 text-sm leading-relaxed">
              {item.answer}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
