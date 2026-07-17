import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Flame, HardDrive, Layers, RefreshCw, Loader2, Wifi, WifiOff } from "lucide-react";
import { PageShell } from "../../components/layout/PageShell";
import { Button } from "../../components/ui/button";
import {
  useFirebaseCollections,
  useFirebaseDocument,
  useFirebaseDocuments,
  useFirebaseStatus,
  useFirebaseStorage,
} from "./hooks/useFirebaseExplorer";
import { CollectionSidebar, DocumentTable, StorageBrowser } from "./components/ExplorerPanes";
import { DocumentInspector } from "./components/DocumentInspector";
import "./firebase-explorer.css";

type Mode = "firestore" | "storage";

export function FirebaseExplorerPage() {
  const [mode, setMode] = useState<Mode>("firestore");
  const [collectionParent, setCollectionParent] = useState("");
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null);
  const [collectionFilter, setCollectionFilter] = useState("");
  const [storagePrefix, setStoragePrefix] = useState("");
  const [userPickedMode, setUserPickedMode] = useState(false);

  const { status, loading: statusLoading, error: statusError, refetch: refetchStatus } = useFirebaseStatus();
  const { collections, loading: colsLoading, error: colsError, refetch: refetchCols } =
    useFirebaseCollections(collectionParent);
  const docs = useFirebaseDocuments(selectedCollection);
  const detail = useFirebaseDocument(selectedDocPath);
  const storage = useFirebaseStorage(storagePrefix);

  useEffect(() => {
    if (userPickedMode || !status) return;
    if (!status.firestoreOk && status.storageOk) setMode("storage");
  }, [status, userPickedMode]);

  const breadcrumb = useMemo(() => {
    if (!selectedCollection) return collectionParent ? collectionParent.split("/") : [];
    return selectedCollection.split("/");
  }, [selectedCollection, collectionParent]);

  const refreshAll = () => {
    void refetchStatus();
    void refetchCols();
    void docs.refetch();
    void storage.refetch();
  };

  return (
    <PageShell fullWidth className="fx-page">
      <div className="fx-shell">
        <motion.header
          className="fx-hero"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="fx-hero-copy">
            <div className="fx-brand-row">
              <Flame className="w-5 h-5 fx-flame" />
              <span className="fx-brand">Firebase Atlas</span>
            </div>
            <p className="fx-hero-sub">
              Live browser for Firestore & Storage · {status?.projectId || "drwretail-bm"}
            </p>
          </div>

          <div className="fx-hero-actions">
            <div className="fx-mode-toggle">
              <button
                type="button"
                className={mode === "firestore" ? "active" : ""}
                onClick={() => {
                  setUserPickedMode(true);
                  setMode("firestore");
                }}
              >
                <Layers className="w-3.5 h-3.5" />
                Firestore
              </button>
              <button
                type="button"
                className={mode === "storage" ? "active" : ""}
                onClick={() => {
                  setUserPickedMode(true);
                  setMode("storage");
                }}
              >
                <HardDrive className="w-3.5 h-3.5" />
                Storage
              </button>
            </div>

            <div className={`fx-status-pill ${status?.ok ? "ok" : "bad"}`}>
              {statusLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : status?.ok ? (
                <Wifi className="w-3.5 h-3.5" />
              ) : (
                <WifiOff className="w-3.5 h-3.5" />
              )}
              {statusLoading
                ? "Connecting"
                : status?.ok
                  ? [
                      status.firestoreOk ? "Firestore" : null,
                      status.storageOk ? "Storage" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Connected"
                  : "Offline"}
              {status?.collectionCount != null && status.firestoreOk
                ? ` · ${status.collectionCount} cols`
                : ""}
            </div>

            <Button variant="outline" size="sm" className="gap-1.5" onClick={refreshAll}>
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </Button>
          </div>
        </motion.header>

        {(statusError ||
          (mode === "firestore" && (status?.firestoreError || colsError)) ||
          (mode === "storage" && status?.storageError)) && (
          <div className="fx-error banner">
            {statusError ||
              (mode === "firestore" ? status?.firestoreError || colsError : status?.storageError)}
            {mode === "firestore" && status?.firestoreError?.includes("NOT_FOUND") && (
              <span>
                {" "}
                — Firestore may not be enabled for this project yet. Storage tab still works.
              </span>
            )}
          </div>
        )}

        {mode === "firestore" ? (
          <motion.div
            className="fx-workspace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.08, duration: 0.3 }}
          >
            <CollectionSidebar
              collections={collections}
              selectedPath={selectedCollection}
              loading={colsLoading}
              filter={collectionFilter}
              onFilter={setCollectionFilter}
              onSelect={(path) => {
                setSelectedCollection(path);
                setSelectedDocPath(null);
                // If selecting from root, clear nested parent context
                if (!path.includes("/")) setCollectionParent("");
              }}
            />

            <div className="fx-main">
              <div className="fx-pathbar">
                <button
                  type="button"
                  className="fx-crumb"
                  onClick={() => {
                    setCollectionParent("");
                    setSelectedCollection(null);
                    setSelectedDocPath(null);
                  }}
                >
                  root
                </button>
                {breadcrumb.map((seg, i) => {
                  const isCollectionSeg = i % 2 === 0;
                  const pathSoFar = breadcrumb.slice(0, i + 1).join("/");
                  return (
                    <span key={pathSoFar} className="fx-crumb-wrap">
                      <span className="fx-sep">/</span>
                      <button
                        type="button"
                        className="fx-crumb"
                        onClick={() => {
                          if (isCollectionSeg) {
                            setSelectedCollection(pathSoFar);
                            setSelectedDocPath(null);
                            const parentDoc = breadcrumb.slice(0, i).join("/");
                            setCollectionParent(parentDoc);
                          } else {
                            setSelectedDocPath(pathSoFar);
                            setSelectedCollection(breadcrumb.slice(0, i).join("/"));
                          }
                        }}
                      >
                        {seg}
                      </button>
                    </span>
                  );
                })}
                {collectionParent && (
                  <button
                    type="button"
                    className="fx-ghost-btn tiny"
                    onClick={() => {
                      setCollectionParent("");
                      setSelectedCollection(null);
                      setSelectedDocPath(null);
                    }}
                  >
                    Back to root
                  </button>
                )}
              </div>

              <div className="fx-split">
                <DocumentTable
                  documents={docs.documents}
                  selectedId={selectedDocPath?.split("/").pop() || null}
                  loading={docs.loading}
                  filter={docs.filter}
                  onFilter={docs.setFilter}
                  onSelect={(doc) => setSelectedDocPath(doc.path)}
                  hasMore={docs.hasMore}
                  onLoadMore={docs.loadMore}
                  rawCount={docs.rawCount}
                />

                <div className="fx-detail">
                  {detail.loading && (
                    <div className="fx-empty inline">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading document…
                    </div>
                  )}
                  {detail.error && <div className="fx-error">{detail.error}</div>}
                  {!selectedDocPath && !detail.loading && (
                    <div className="fx-empty detail">
                      <Flame className="w-8 h-8 opacity-30 mb-3" />
                      Pick a document to inspect fields, types, and nested collections
                    </div>
                  )}
                  {detail.document && (
                    <DocumentInspector
                      documentId={detail.document.id}
                      path={detail.document.path}
                      data={detail.document.data}
                      subcollections={detail.subcollections}
                      onOpenSubcollection={(path) => {
                        const parentDoc = path.split("/").slice(0, -1).join("/");
                        setCollectionParent(parentDoc);
                        setSelectedCollection(path);
                        setSelectedDocPath(null);
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            className="fx-workspace storage-mode"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.08, duration: 0.3 }}
          >
            <StorageBrowser
              bucket={storage.bucket}
              prefix={storagePrefix}
              folders={storage.folders}
              files={storage.files}
              loading={storage.loading}
              error={storage.error}
              hasMore={storage.hasMore}
              onOpenFolder={setStoragePrefix}
              onNavigatePrefix={setStoragePrefix}
              onLoadMore={storage.loadMore}
            />
          </motion.div>
        )}
      </div>
    </PageShell>
  );
}

export default FirebaseExplorerPage;
