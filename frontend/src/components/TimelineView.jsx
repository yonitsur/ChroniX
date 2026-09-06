import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Timeline, Article } from 'histropediajs';
import { getLaneColor, isColorLight, DEFAULT_LANE_COLORS } from '../data/laneColors';

// Reimplement Article.prototype.drawPeriodLinesAndConnectors so the period line and connector line
// are semi-transparent in the normal state (100% solid when hovered/selected/active), while the arrow
// triangle at the card is always filled opaquely — otherwise the connector line shows through it.
if (typeof window !== 'undefined' && Article) {
  if (!Article.prototype._originalChroniXDrawPeriodLinesAndConnectors) {
    Article.prototype._originalChroniXDrawPeriodLinesAndConnectors = Article.prototype.drawPeriodLinesAndConnectors;
  }
  Article.prototype.drawPeriodLinesAndConnectors = function(ctx, axisY) {
    const selectedId = this.owner?._selectedArticleId;
    const isSelected = selectedId ? (this.id === selectedId) : false;
    const isHigh = Boolean(this.isMouseover || this.isDragging || isSelected);
    const baseAlpha = typeof this.opacity === 'number' ? this.opacity : 1;
    const lineAlpha = isHigh ? baseAlpha : baseAlpha * 0.45;

    const style = this._getCurrentStyle();
    const geometry = this._getPeriodLineRenderGeometry(axisY);
    const y = geometry.y;

    ctx.globalAlpha = lineAlpha;
    if (!this.hidePeriodLine) {
      const fromX = this.indicator.fromX, toX = this.indicator.toX;
      ctx.beginPath();
      ctx.lineWidth = geometry.thickness;
      ctx.moveTo(fromX, y);
      ctx.lineTo(toX, y);
      if (this.period.isToPresent) {
        const periodLength = toX - fromX, maxFadeLength = 15;
        const fadeStartColorStop = Math.max(1 - maxFadeLength / periodLength, 0.7);
        const grad = ctx.createLinearGradient(fromX, y, toX, y);
        grad.addColorStop(0, style.color);
        grad.addColorStop(fadeStartColorStop, style.color);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
      } else {
        ctx.strokeStyle = style.color;
      }
      ctx.stroke();
    }

    if (!style.connectorLine.visible) {
      ctx.globalAlpha = 1;
      return;
    }

    const cardLayout = this._getCurrentCardLayout();
    const connectorEnd = typeof cardLayout.getConnectorEnd === 'function'
      ? cardLayout.getConnectorEnd.call(this)
      : {
          left: this.position.left + style.connectorLine.offsetX,
          top: this.position.top + this.getHeight() + style.connectorLine.offsetY,
        };
    const x1 = Math.max(0, this.indicator.fromX);
    const y1 = y;
    const x2 = connectorEnd.left;
    const y2 = connectorEnd.top;

    // Connector line: semi-transparent in the normal state.
    ctx.globalAlpha = lineAlpha;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.connectorLine.thickness;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrow triangle: always fully opaque so the connector line never shows through it.
    const radians = Math.atan((y2 - y1) / (x2 - x1)) + (x2 >= x1 ? -90 : 90) * Math.PI / 180;
    ctx.globalAlpha = baseAlpha;
    ctx.fillStyle = style.color;
    ctx.save();
    ctx.beginPath();
    ctx.translate(x2, y2);
    ctx.rotate(radians);
    ctx.moveTo(-style.connectorLine.arrow.width, 0);
    ctx.lineTo(style.connectorLine.arrow.width, 0);
    ctx.lineTo(0, -style.connectorLine.arrow.height);
    ctx.closePath();
    ctx.restore();
    ctx.fill();

    ctx.globalAlpha = 1;
  };

  // Patch Article.prototype._getCurrentStyle so that in landscape layout (used in multi-lane / multi-timeline view),
  // event titles always contrast against the card background (dark text on white cards in day mode!)
  if (!Article.prototype._originalChroniXGetCurrentStyle) {
    Article.prototype._originalChroniXGetCurrentStyle = Article.prototype._getCurrentStyle;
  }
  const originalGetCurrentStyle = Article.prototype._originalChroniXGetCurrentStyle;
  Article.prototype._getCurrentStyle = function() {
    const style = originalGetCurrentStyle.call(this);
    if (!style) return style;

    const layoutName = typeof this._getCurrentCardLayoutName === 'function'
      ? this._getCurrentCardLayoutName()
      : (this._resolvedCardLayoutName || 'portrait');

    if (layoutName === 'landscape') {
      const bg = style.backgroundColor || (this.owner?._isDarkTheme ? '#0f172a' : '#ffffff');
      const isBgLight = isColorLight(bg);
      const landscapeTextColor = isBgLight ? '#0f172a' : '#f8fafc';
      return {
        ...style,
        header: {
          ...style.header,
          text: {
            ...style.header?.text,
            color: landscapeTextColor
          }
        }
      };
    }

    return style;
  };

  Article.prototype._hasChroniXAlphaPatch = true;
}

// Convert a hex color (#rgb or #rrggbb) to an rgba string with the given alpha.
function hexToRgba(hex, alpha = 1) {
  if (typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return hex;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveArticleLaneColor(laneIdentifier, lanes = []) {
  if (!laneIdentifier && lanes.length > 0) {
    return getLaneColor(lanes[0], 0, lanes);
  }
  if (laneIdentifier && lanes.length > 0) {
    const str = String(laneIdentifier).toLowerCase().trim();
    const foundIdx = lanes.findIndex(
      (l) =>
        String(l.id).toLowerCase() === str ||
        String(l.title || '').toLowerCase() === str
    );
    if (foundIdx >= 0) {
      return getLaneColor(lanes[foundIdx], foundIdx, lanes);
    }
  }
  const fallbackStr = String(laneIdentifier || 'default');
  let hash = 0;
  for (let i = 0; i < fallbackStr.length; i++) {
    hash = (hash << 5) - hash + fallbackStr.charCodeAt(i);
    hash |= 0;
  }
  return DEFAULT_LANE_COLORS[Math.abs(hash) % DEFAULT_LANE_COLORS.length];
}

const TimelineView = forwardRef(({
  timelineData,
  onSelectArticle,
  selectedArticleId,
  starredArticleIds,
  onToggleStar,
  theme = 'light'
}, ref) => {
  const containerRef = useRef(null);
  const timelineInstanceRef = useRef(null);
  const starredArticleIdsRef = useRef(starredArticleIds);

  useEffect(() => {
    starredArticleIdsRef.current = starredArticleIds;
  }, [starredArticleIds]);

  // Synchronize external selection with Histropedia canvas instance
  useEffect(() => {
    const tl = timelineInstanceRef.current;
    if (tl) {
      tl._selectedArticleId = selectedArticleId || null;
      if (selectedArticleId) {
        try {
          tl.select(selectedArticleId);
        } catch (e) {
          // ignore
        }
      } else {
        if (tl.articles) {
          tl.articles.forEach((a) => {
            a.isActive = false;
          });
        }
      }
      tl.redraw();
    }
  }, [selectedArticleId]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        const currentZoom = tl.getZoom();
        tl.setZoom(Math.max(0, currentZoom - 4));
      }
    },
    zoomOut: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        const currentZoom = tl.getZoom();
        tl.setZoom(currentZoom + 4);
      }
    },
    fitAll: () => {
      const tl = timelineInstanceRef.current;
      if (tl) {
        tl.fitArticles({ padding: 60 });
      }
    },
    focusArticle: (articleId) => {
      const tl = timelineInstanceRef.current;
      if (tl && articleId) {
        tl._selectedArticleId = articleId;
        const art = tl.getArticleById(articleId);
        if (art) {
          try {
            tl.fitArticleRange(art, { padding: 120 });
          } catch (e) {
            console.warn('fitArticleRange fallback:', e);
            const date = art.from || art.data?.from || art.period?.from;
            if (date) {
              tl.setCentreDate(date);
            }
          }
          try {
            tl.select(articleId);
            tl.bringFront(articleId);
          } catch (e) {
            // ignore
          }
          tl.redraw();
        }
      }
    },
    setArticleStarred: (articleId, isStarred) => {
      const tl = timelineInstanceRef.current;
      if (tl && articleId) {
        const art = tl.getArticleById(articleId);
        if (art) {
          art.setOption('starred', isStarred);
          tl.redraw();
        }
      }
    },
    setFilterStarredOnly: (onlyStarred, currentStarredIds) => {
      const tl = timelineInstanceRef.current;
      if (tl && tl.articles) {
        const ids = currentStarredIds || starredArticleIdsRef.current || new Set();
        tl.articles.forEach((art) => {
          art.setOption('hiddenByFilter', onlyStarred ? !ids.has(art.id) : false);
        });
        tl.redraw();
        try {
          tl.fitArticles({ padding: 70 });
        } catch (e) {
          // ignore
        }
      }
    },
    getCanvas: () => {
      return timelineInstanceRef.current?.canvas || null;
    }
  }));

  useEffect(() => {
    if (!containerRef.current || !timelineData) return;

    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 1000;
    const height = container.clientHeight || 600;

    const isDark = theme === 'dark';

    // Find a reasonable initial date
    let initialDate = { year: 1950, month: 1, day: 1 };
    if (timelineData.articles && timelineData.articles.length > 0) {
      const first = timelineData.articles[0];
      if (first.from) {
        initialDate = {
          year: first.from.year,
          month: first.from.month || 1,
          day: first.from.day || 1,
        };
      }
    }

    const articleStyle = {
      backgroundColor: isDark ? '#0f172a' : '#ffffff',
      color: isDark ? '#1e293b' : '#f1f5f9',
      topRadius: 6,
      borderRadius: 6,
      border: {
        color: isDark ? '#334155' : '#cbd5e1',
        width: 1,
      },
      header: {
        height: 50,
        text: {
          font: "600 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
          color: isDark ? '#f8fafc' : '#0f172a',
          margin: 10,
          lineHeight: 18,
          numberOfLines: 2,
        }
      },
      subheader: {
        height: 26,
        color: isDark ? '#0b1120' : '#e2e8f0',
        text: {
          font: "500 11px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
          color: isDark ? '#94a3b8' : '#64748b',
          margin: 10,
          lineHeight: 14,
        }
      },
      shadow: {
        x: 0,
        y: 3,
        amount: isDark ? 8 : 4,
        color: isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.08)',
      },
      connectorLine: {
        visible: true,
        thickness: 1.5,
        color: isDark ? '#475569' : '#94a3b8',
      }
    };

    try {
      const options = {
        width,
        height,
        initialDate,
        disableBranding: true,
        enableUserControl: true,
        enableCursor: true,
        verticalOffset: 65,
        style: {
          mainLine: {
            visible: true,
            size: 8,
          },
          dateLabel: {
            minor: {
              color: isDark ? '#94a3b8' : '#475569',
              font: "500 11px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
            },
            major: {
              color: isDark ? '#f8fafc' : '#0f172a',
              font: "700 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
            }
          },
          marker: {
            minor: {
              height: 12,
              color: isDark ? '#38bdf8' : '#0284c7',
            },
            major: {
              height: 24,
              color: isDark ? '#818cf8' : '#4338ca',
            }
          }
        },
        lane: {
          visible: true,
          gap: 16,
          axisGap: 30,
          defaultStyle: {
            header: {
              backgroundColor: isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(241, 245, 249, 0.95)',
            },
            body: {
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.4)' : 'rgba(255, 255, 255, 0.65)',
              borderColor: isDark ? 'rgba(51, 65, 85, 0.5)' : 'rgba(203, 213, 225, 0.8)',
            },
            title: {
              color: isDark ? '#f1f5f9' : '#1e293b',
              font: "600 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
            }
          }
        },
        timeBand: {
          visible: true,
          reserveSpace: true,
        },
        article: {
          cardLayout: 'portrait',
          draggable: true,
          autoStacking: {
            active: true,
            fitToHeight: true,
            rowSpacing: 40,
          },
          periodLine: {
            thickness: 8,
            spacing: 4,
          },
          defaultStyle: articleStyle,
          defaultHoverStyle: {
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            border: {
              width: 2,
            },
            shadow: {
              x: 0,
              y: 6,
              amount: 14,
              color: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.16)',
            }
          },
          defaultActiveStyle: {
            backgroundColor: isDark ? '#172554' : '#eff6ff',
            border: {
              width: 2.5,
            }
          },
          layoutStyles: {
            landscape: {
              style: {
                header: {
                  text: {
                    color: isDark ? '#f8fafc' : '#0f172a',
                  }
                },
                subheader: {
                  text: {
                    color: isDark ? '#94a3b8' : '#64748b',
                  }
                }
              },
              hoverStyle: {
                header: {
                  text: {
                    color: isDark ? '#f8fafc' : '#0f172a',
                  }
                }
              },
              activeStyle: {
                header: {
                  text: {
                    color: isDark ? '#f8fafc' : '#0f172a',
                  }
                }
              }
            }
          }
        }
      };

      const timeline = new Timeline(container, options);
      timelineInstanceRef.current = timeline;
      timeline._isDarkTheme = isDark;

      // 1. Load lanes if any
      if (timelineData.lanes && timelineData.lanes.length > 0) {
        timeline.loadLanes(
          timelineData.lanes.map((l, idx) => {
            const laneColor = getLaneColor(l, idx, timelineData.lanes);
            const isLight = isColorLight(laneColor);
            const textColor = isLight ? '#0f172a' : '#ffffff';

            return {
              id: l.id,
              title: l.title,
              layout: {
                header: {
                  height: 28,
                  padding: { left: 14, right: 14 }
                }
              },
              style: {
                header: {
                  backgroundColor: laneColor,
                },
                body: {
                  backgroundColor: isDark ? 'rgba(15, 23, 42, 0.4)' : 'rgba(255, 255, 255, 0.65)',
                  borderColor: isDark ? 'rgba(51, 65, 85, 0.5)' : 'rgba(203, 213, 225, 0.8)',
                },
                title: {
                  color: textColor,
                  font: "600 13px 'Plus Jakarta Sans', Heebo, system-ui, sans-serif",
                }
              }
            };
          })
        );
      }

      // Helper to tone down timeband background in dark mode
      const formatBandBg = (color) => {
        if (!color) return isDark ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.08)';
        if (typeof color === 'string' && color.startsWith('rgba')) {
          return isDark ? color.replace(/[\d\.]+\)$/, '0.12)') : color;
        }
        if (typeof color === 'string' && color.startsWith('#')) {
          let hex = color.slice(1);
          if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
          if (hex.length === 6) {
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${isDark ? 0.12 : 0.09})`;
          }
        }
        return color;
      };

      // 2. Load time bands if any
      if (timelineData.timeBands && timelineData.timeBands.length > 0) {
        timeline.loadTimeBands(
          timelineData.timeBands.map((tb) => ({
            id: tb.id,
            title: tb.title,
            from: tb.from,
            to: tb.to,
            style: {
              background: formatBandBg(tb.color),
            }
          }))
        );
      }

      // 3. Load articles
      if (timelineData.articles && timelineData.articles.length > 0) {
        const formattedArticles = timelineData.articles.map((art) => {
          const laneColor = resolveArticleLaneColor(art.lane, timelineData.lanes);
          const isLight = isColorLight(laneColor);
          const headerTextColor = isLight ? '#0f172a' : '#ffffff';

          return {
            ...art,
            id: art.id,
            title: art.title,
            subtitle: art.subtitle || '',
            lane: art.lane,
            from: art.from,
            to: art.to || undefined,
            isToPresent: art.isToPresent || false,
            imageUrl: art.imageUrl || undefined,
            rank: art.rank || 5,
            starred: starredArticleIdsRef.current?.has(art.id) || !!art.starred,
            style: {
              ...articleStyle,
              color: laneColor,
              border: {
                color: '#000000',
                width: 1.5,
              },
              header: {
                ...articleStyle.header,
                text: {
                  ...articleStyle.header.text,
                  color: headerTextColor,
                }
              },
              connectorLine: {
                ...articleStyle.connectorLine,
                color: laneColor,
              }
            },
            hoverStyle: {
              ...articleStyle,
              color: laneColor,
              backgroundColor: isDark ? '#1e293b' : '#ffffff',
              border: {
                color: laneColor,
                width: 2,
              },
              header: {
                ...articleStyle.header,
                text: {
                  ...articleStyle.header.text,
                  color: headerTextColor,
                }
              },
              connectorLine: {
                ...articleStyle.connectorLine,
                color: laneColor,
                thickness: 2,
              }
            },
            activeStyle: {
              ...articleStyle,
              color: laneColor,
              backgroundColor: isDark ? '#172554' : '#eff6ff',
              border: {
                color: laneColor,
                width: 2.5,
              },
              header: {
                ...articleStyle.header,
                text: {
                  ...articleStyle.header.text,
                  color: headerTextColor,
                }
              },
              connectorLine: {
                ...articleStyle.connectorLine,
                color: laneColor,
                thickness: 2.5,
              }
            },
            // Attach custom rich data into article object for drawer
            wikiUrl: art.wikiUrl,
            extract: art.extract,
            wikiTitle: art.wikiTitle,
            locationName: art.locationName,
            lat: art.lat,
            lng: art.lng,
            googleMapsUrl: art.googleMapsUrl,
          };
        });

        timeline.load(formattedArticles);

        // Sync initial selection state so unselected articles start with semi-transparent lines
        timeline._selectedArticleId = selectedArticleId || null;
        if (selectedArticleId) {
          try {
            timeline.select(selectedArticleId);
          } catch (e) {
            // ignore
          }
        } else if (timeline.articles) {
          timeline.articles.forEach((a) => {
            a.isActive = false;
          });
          timeline.redraw();
        }

        // Fit articles in view
        setTimeout(() => {
          try {
            timeline.fitArticles({ padding: 70 });
          } catch (e) {
            console.warn('fitArticles fallback:', e);
          }
        }, 100);
      }

      // Event listener for article clicks
      timeline.on('article-click', (article) => {
        const clickedId = article?.id || article?.data?.id;
        if (!clickedId) return;

        // If the user clicked specifically on the star icon on canvas
        if (article.isMouseOverStar) {
          onToggleStar?.(clickedId, article.isStarred);
          return;
        }

        if (timelineInstanceRef.current) {
          timelineInstanceRef.current._selectedArticleId = clickedId;
          timelineInstanceRef.current.redraw();
        }

        if (onSelectArticle) {
          const original = timelineData.articles?.find((a) => a.id === clickedId);
          onSelectArticle(original || article.data || article);
        }
      });

      // Event listener for timeline background clicks (deselection)
      timeline.on('timeline-click', () => {
        if (timelineInstanceRef.current) {
          timelineInstanceRef.current._selectedArticleId = null;
          if (timelineInstanceRef.current.articles) {
            timelineInstanceRef.current.articles.forEach((a) => {
              a.isActive = false;
            });
          }
          timelineInstanceRef.current.redraw();
        }
        onSelectArticle?.(null);
      });

    } catch (err) {
      console.error('Histropedia initialization failed:', err);
    }

    // Resize observer to keep canvas full size
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: newWidth, height: newHeight } = entry.contentRect;
        if (newWidth > 0 && newHeight > 0 && timelineInstanceRef.current) {
          try {
            timelineInstanceRef.current.setSize(newWidth, newHeight);
          } catch (e) {
            // ignore during unmount
          }
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      timelineInstanceRef.current = null;
      container.innerHTML = '';
    };
  }, [timelineData, theme]);

  return (
    <div
      dir="ltr"
      className="w-full h-full relative overflow-hidden bg-slate-100 dark:bg-slate-950 select-none transition-colors duration-200 histropedia-timeline-wrapper"
    >
      <div
        ref={containerRef}
        id="histropedia-container"
        dir="ltr"
        className="w-full h-full absolute inset-0"
        style={{ touchAction: 'none' }}
      />
    </div>
  );
});

TimelineView.displayName = 'TimelineView';
export default TimelineView;
