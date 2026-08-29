import { useState, useEffect } from 'react';
import { useParams, useNavigate, NavLink } from 'react-router-dom';
import { Save, Image as ImageIcon, Search, Trash2, UploadCloud } from 'lucide-react';
import { BACKEND_URL } from '../config';

function SingleCatalogSetup({ socket }) {
  const { category } = useParams();
  const activeCategory = category ? category.replace('-', '_') : 'jewellery_set';
  const defaultFormState = {
    gst: '', hsnCode: '', netWeight: '', productName: '', size: 'Free Size',
    meeshoPrice: '', wrongPrice: '', mrp: '', inventory: '', lengthSizeInch: '',

    baseMetal: '', genericName: '', includedComponents: '', netQuantity: '',
    occasion: '', plating: '', productDimensionUnit: '', productHeight: '',
    productLength: '', productWidth: '', productBreadth: '', sizing: '', stoneType: '',
    trend: '', type: '', countryOfOrigin: '', length: '',
    careInstructions: '', closureType: '', fillingMaterial: '', material: '',
    packagingBreadth: '', packagingHeight: '', packagingLength: '',
    packagingUnit: '', pattern: '', waterResistanceLevel: '', weightUnit: '',
    capacityInL: '', leakProof: '', productWeight: '', productWeightUnit: '',
    volumeUnit: '', bisIsiCertificationNumber: '',

    manufacturerName: '', manufacturerAddress: '', manufacturerPincode: '',
    packerName: '', packerAddress: '', packerPincode: '',
    importerName: '', importerAddress: '', importerPincode: '',

    addOn: '', brand: '', color: '', description: ''
  };

  const [formData, setFormData] = useState(defaultFormState);

  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [photoSearchQuery, setPhotoSearchQuery] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);

  const fetchImages = () => {
    fetch(`${BACKEND_URL}/api/single-catalog-images`)
      .then(res => res.json())
      .then(data => {
        setImages(data);
        setSelectedImages(prev => prev.filter(name => data.some(img => img.name === name)));
      })
      .catch(console.error);
  };

  const fetchDefaults = () => {
    setLoading(true);
    fetch(`${BACKEND_URL}/api/single-catalog-defaults?category=${activeCategory}&t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        if (data && Object.keys(data).length > 0) {
          setFormData({ ...defaultFormState, ...data });
        } else {
          setFormData(defaultFormState);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchImages();
    fetchDefaults();
  }, [activeCategory]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/single-catalog-defaults?category=${activeCategory}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        alert('Defaults saved successfully!');
      }
    } catch (e) {
      alert('Failed to save defaults.');
    }
  };



  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files.length) return;

    setUploading(true);
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) {
      fd.append('files', files[i]);
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/single-catalog-images`, {
        method: 'POST',
        body: fd
      });
      if (res.ok) fetchImages();
    } catch (error) {
      console.error(error);
      alert('Failed to upload images.');
    } finally {
      setUploading(false);
      e.target.value = null;
    }
  };

  const handleDeleteImage = async (filename) => {
    if (!window.confirm(`Delete ${filename}?`)) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/single-catalog-images/${filename}`, { method: 'DELETE' });
      if (res.ok) fetchImages();
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('Are you sure you want to delete ALL uploaded photos?')) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/single-catalog-images`, { method: 'DELETE' });
      if (res.ok) fetchImages();
    } catch (error) {
      console.error(error);
    }
  };

  const toggleSelectImage = (filename) => {
    setSelectedImages(prev =>
      prev.includes(filename)
        ? prev.filter(name => name !== filename)
        : [...prev, filename]
    );
  };

  const handleDeleteSelected = async () => {
    if (!window.confirm(`Are you sure you want to delete the ${selectedImages.length} selected photos?`)) return;
    try {
      const deletePromises = selectedImages.map(filename =>
        fetch(`${BACKEND_URL}/api/single-catalog-images/${filename}`, { method: 'DELETE' })
      );
      await Promise.all(deletePromises);
      setSelectedImages([]);
      fetchImages();
    } catch (error) {
      console.error(error);
      alert('Failed to delete selected photos.');
    }
  };

  if (loading) return <div className="glass-panel">Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '2rem' }}>
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem' }}>Single Catalog Setup</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Set the default details for {
              activeCategory === 'jewellery_set' ? 'Jewellery Set' :
              activeCategory === 'mangalsutras' ? 'Mangalsutras' :
              activeCategory === 'mattress_protection' ? 'Mattress Protection' :
              'Water Bottles (Tumbler)'
            } uploads. These will be applied to all your photos.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <NavLink
              to="/single-catalog/jewellery-set"
              className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            >
              Jewellery Set
            </NavLink>
            <NavLink
              to="/single-catalog/mangalsutras"
              className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            >
              Mangalsutras
            </NavLink>
            <NavLink
              to="/single-catalog/mattress-protection"
              className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            >
              Mattress Protection
            </NavLink>
            <NavLink
              to="/single-catalog/water-bottles"
              className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            >
              Water Bottles (Tumbler)
            </NavLink>
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleSave}>
          <Save size={16} /> Save Defaults
        </button>
      </div>

      {/* Photo Upload Section */}
      <div className="glass-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
              <ImageIcon size={18} color="var(--primary)" /> Uploaded Photos ({images.length})
            </h3>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="search"
                className="input-field"
                placeholder="Search photos..."
                value={photoSearchQuery}
                onChange={(e) => setPhotoSearchQuery(e.target.value)}
                style={{ paddingLeft: '32px', minWidth: '200px', paddingTop: '7px', paddingBottom: '7px' }}
              />
            </div>
            {selectedImages.length > 0 ? (
              <button
                className="btn btn-danger"
                style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                onClick={handleDeleteSelected}
                disabled={uploading}
              >
                <Trash2 size={15} /> Delete Selected ({selectedImages.length})
              </button>
            ) : (
              images.length > 0 && (
                <button
                  className="btn btn-danger"
                  style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  onClick={handleDeleteAll}
                  disabled={uploading}
                >
                  <Trash2 size={15} /> Remove All
                </button>
              )
            )}
            <label className="btn btn-primary" style={{ cursor: 'pointer', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <UploadCloud size={15} /> {uploading ? 'Uploading...' : 'Upload Photos'}
              <input type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} disabled={uploading} />
            </label>
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
          Upload your SKUs (e.g., `isr_2981.jpg`) and your common files (`_a.jpg`, `_b.jpg`, `_c.jpg`) here. The bot will read them from this list.
        </p>

        {images.length === 0 ? (
          <label className="upload-empty-state" style={{ width: '100%' }}>
            <UploadCloud size={40} color="var(--primary)" />
            <h4 style={{ margin: '0.25rem 0' }}>No photos uploaded yet</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Click to select and upload your product photos</p>
            <input type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} disabled={uploading} />
          </label>
        ) : (
          <div className="photo-grid-container">
            {images
              .filter(img => !photoSearchQuery || img.name.toLowerCase().includes(photoSearchQuery.toLowerCase()))
              .map(img => {
                const isSelected = selectedImages.includes(img.name);
                const formatSize = (bytes) => {
                  if (!bytes) return '0 B';
                  const k = 1024;
                  const sizes = ['B', 'KB', 'MB'];
                  const i = Math.floor(Math.log(bytes) / Math.log(k));
                  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
                };
                return (
                  <div
                    key={img.name}
                    className="photo-card"
                    style={{
                      cursor: 'pointer',
                      ...(isSelected ? { borderColor: 'var(--primary)', boxShadow: '0 0 10px rgba(99, 102, 241, 0.3)' } : {})
                    }}
                    onClick={() => setPreviewImage(img)}
                  >
                    <input
                      type="checkbox"
                      style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        width: '18px',
                        height: '18px',
                        cursor: 'pointer',
                        accentColor: 'var(--primary)',
                        zIndex: 5
                      }}
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelectImage(img.name)}
                    />
                    <button
                      className="delete-photo-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteImage(img.name);
                      }}
                      title="Delete Photo"
                    >
                      <Trash2 size={12} />
                    </button>
                    <div className="photo-card-img-wrapper">
                      <img
                        src={`${BACKEND_URL}/single_catalog_images/${encodeURIComponent(img.name)}`}
                        alt={img.name}
                        className="photo-card-img"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'block';
                        }}
                      />
                      <div style={{ display: 'none' }}><ImageIcon size={32} color="var(--text-muted)" /></div>
                    </div>
                    <div className="photo-card-info">
                      <div className="photo-card-name" title={img.name}>
                        {img.name}
                      </div>
                      <div className="photo-card-size">
                        {img.size ? formatSize(img.size) : 'N/A'}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Product, Size & Inventory</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group"><label className='form-label'>GST <span>*</span></label><input className="input-field" name="gst" value={formData.gst} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>HSN Code <span>*</span></label><input className="input-field" name="hsnCode" value={formData.hsnCode} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Net Weight (gms) <span>*</span></label><input className="input-field" name="netWeight" value={formData.netWeight} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Product Name <span>*</span></label><input className="input-field" name="productName" value={formData.productName} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Size <span>*</span></label><input className="input-field" name="size" value={formData.size} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Inventory <span>*</span></label><input className="input-field" name="inventory" value={formData.inventory} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Meesho Price <span>*</span></label><input className="input-field" name="meeshoPrice" value={formData.meeshoPrice} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Wrong/Defective Price</label><input className="input-field" name="wrongPrice" value={formData.wrongPrice} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>MRP <span>*</span></label><input className="input-field" name="mrp" value={formData.mrp} onChange={handleChange} /></div>
              {activeCategory === 'mangalsutras' && (
                <div className="form-group">
                  <label className='form-label'>Length Size (INCH)</label>
                  <input className="input-field" name="lengthSizeInch" value={formData.lengthSizeInch || ''} onChange={handleChange} placeholder="e.g. 18" />
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Other Attributes</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group"><label className='form-label'>Color</label><input className="input-field" name="color" value={formData.color} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Brand</label><input className="input-field" name="brand" value={formData.brand} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Add On</label><input className="input-field" name="addOn" value={formData.addOn} onChange={handleChange} /></div>
              {activeCategory === 'mangalsutras' && (
                <div className="form-group">
                  <label className='form-label'>Type</label>
                  <input className="input-field" name="type" value={formData.type || ''} onChange={handleChange} placeholder="e.g. Big pendant mangalsutra" />
                </div>
              )}
              {activeCategory === 'water_bottles' && (
                <div className="form-group">
                  <label className='form-label'>BIS/ISI Certification Number</label>
                  <input className="input-field" name="bisIsiCertificationNumber" value={formData.bisIsiCertificationNumber || ''} onChange={handleChange} placeholder="Enter BIS/ISI Certification Number" />
                </div>
              )}
              <div className="form-group" >
                <label className='form-label'>Description</label>
                <textarea className="input-field" style={{ height: '80px', resize: 'vertical' }} name="description" value={formData.description} onChange={handleChange} />
              </div>
            </div>
          </div>

        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Product Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {activeCategory === 'mattress_protection' ? (
                <>
                  <div className="form-group"><label className='form-label'>Care Instructions <span>*</span></label><input className="input-field" name="careInstructions" value={formData.careInstructions} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Closure Type <span>*</span></label><input className="input-field" name="closureType" value={formData.closureType} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Color <span>*</span></label><input className="input-field" name="color" value={formData.color} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Filling Material <span>*</span></label><input className="input-field" name="fillingMaterial" value={formData.fillingMaterial} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Generic Name <span>*</span></label><input className="input-field" name="genericName" value={formData.genericName} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Material <span>*</span></label><input className="input-field" name="material" value={formData.material} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Net Quantity (N) <span>*</span></label><input className="input-field" name="netQuantity" value={formData.netQuantity} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Packaging Breadth <span>*</span></label><input className="input-field" name="packagingBreadth" value={formData.packagingBreadth} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Packaging Height <span>*</span></label><input className="input-field" name="packagingHeight" value={formData.packagingHeight} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Packaging Length <span>*</span></label><input className="input-field" name="packagingLength" value={formData.packagingLength} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Packaging Unit <span>*</span></label><input className="input-field" name="packagingUnit" value={formData.packagingUnit} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Pattern <span>*</span></label><input className="input-field" name="pattern" value={formData.pattern} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Breadth <span>*</span></label><input className="input-field" name="productBreadth" value={formData.productBreadth} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Height <span>*</span></label><input className="input-field" name="productHeight" value={formData.productHeight} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Length <span>*</span></label><input className="input-field" name="productLength" value={formData.productLength} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Unit <span>*</span></label><input className="input-field" name="productDimensionUnit" value={formData.productDimensionUnit} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Weight <span>*</span></label><input className="input-field" name="productWeight" value={formData.productWeight} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Size <span>*</span></label><input className="input-field" name="sizing" value={formData.sizing} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Water Resistance Level <span>*</span></label><input className="input-field" name="waterResistanceLevel" value={formData.waterResistanceLevel} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Weight Unit <span>*</span></label><input className="input-field" name="weightUnit" value={formData.weightUnit} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>COUNTRY OF ORIGIN <span>*</span></label><input className="input-field" name="countryOfOrigin" value={formData.countryOfOrigin} onChange={handleChange} /></div>
                </>
              ) : activeCategory === 'water_bottles' ? (
                <>
                  <div className="form-group"><label className='form-label'>Add Ons <span>*</span></label><input className="input-field" name="addOn" value={formData.addOn} onChange={handleChange} placeholder="e.g. Straw" /></div>
                  <div className="form-group"><label className='form-label'>Capacity In L <span>*</span></label><input className="input-field" name="capacityInL" value={formData.capacityInL} onChange={handleChange} placeholder="e.g. 2" /></div>
                  <div className="form-group"><label className='form-label'>Color <span>*</span></label><input className="input-field" name="color" value={formData.color} onChange={handleChange} placeholder="e.g. Blue" /></div>
                  <div className="form-group"><label className='form-label'>Generic Name <span>*</span></label><input className="input-field" name="genericName" value={formData.genericName} onChange={handleChange} placeholder="e.g. Water Bottles" /></div>
                  <div className="form-group"><label className='form-label'>Leak Proof <span>*</span></label><input className="input-field" name="leakProof" value={formData.leakProof} onChange={handleChange} placeholder="e.g. Yes" /></div>
                  <div className="form-group"><label className='form-label'>Material <span>*</span></label><input className="input-field" name="material" value={formData.material} onChange={handleChange} placeholder="e.g. Plastic" /></div>
                  <div className="form-group"><label className='form-label'>Net Quantity (N) <span>*</span></label><input className="input-field" name="netQuantity" value={formData.netQuantity} onChange={handleChange} placeholder="e.g. Pack Of 1" /></div>
                  <div className="form-group"><label className='form-label'>Product Breadth <span>*</span></label><input className="input-field" name="productBreadth" value={formData.productBreadth} onChange={handleChange} placeholder="e.g. 4.5" /></div>
                  <div className="form-group"><label className='form-label'>Product Height <span>*</span></label><input className="input-field" name="productHeight" value={formData.productHeight} onChange={handleChange} placeholder="e.g. 10" /></div>
                  <div className="form-group"><label className='form-label'>Product Length <span>*</span></label><input className="input-field" name="productLength" value={formData.productLength} onChange={handleChange} placeholder="e.g. 4.5" /></div>
                  <div className="form-group"><label className='form-label'>Product Unit <span>*</span></label><input className="input-field" name="productDimensionUnit" value={formData.productDimensionUnit} onChange={handleChange} placeholder="e.g. Inch" /></div>
                  <div className="form-group"><label className='form-label'>Product Weight <span>*</span></label><input className="input-field" name="productWeight" value={formData.productWeight} onChange={handleChange} placeholder="e.g. 200" /></div>
                  <div className="form-group"><label className='form-label'>Product Weight Unit <span>*</span></label><input className="input-field" name="productWeightUnit" value={formData.productWeightUnit} onChange={handleChange} placeholder="e.g. G" /></div>
                  <div className="form-group"><label className='form-label'>Type <span>*</span></label><input className="input-field" name="type" value={formData.type} onChange={handleChange} placeholder="e.g. Others" /></div>
                  <div className="form-group"><label className='form-label'>Volume Unit <span>*</span></label><input className="input-field" name="volumeUnit" value={formData.volumeUnit} onChange={handleChange} placeholder="e.g. L" /></div>
                  <div className="form-group"><label className='form-label'>COUNTRY OF ORIGIN <span>*</span></label><input className="input-field" name="countryOfOrigin" value={formData.countryOfOrigin} onChange={handleChange} placeholder="e.g. India" /></div>
                </>
              ) : (
                <>
                  <div className="form-group"><label className='form-label'>Base Metal <span>*</span></label><input className="input-field" name="baseMetal" value={formData.baseMetal} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Plating <span>*</span></label><input className="input-field" name="plating" value={formData.plating} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Stone Type <span>*</span></label><input className="input-field" name="stoneType" value={formData.stoneType} onChange={handleChange} /></div>
                  {activeCategory !== 'mangalsutras' && (
                    <div className="form-group"><label className='form-label'>Type <span>*</span></label><input className="input-field" name="type" value={formData.type} onChange={handleChange} /></div>
                  )}
                  <div className="form-group"><label className='form-label'>Sizing <span>*</span></label><input className="input-field" name="sizing" value={formData.sizing} onChange={handleChange} /></div>
                  {activeCategory === 'mangalsutras' && (
                    <div className="form-group">
                      <label className='form-label'>Length <span>*</span></label>
                      <input className="input-field" name="length" value={formData.length || ''} onChange={handleChange} />
                    </div>
                  )}
                  <div className="form-group"><label className='form-label'>Trend <span>*</span></label><input className="input-field" name="trend" value={formData.trend} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Occasion <span>*</span></label><input className="input-field" name="occasion" value={formData.occasion} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Net Quantity (N) <span>*</span></label><input className="input-field" name="netQuantity" value={formData.netQuantity} onChange={handleChange} /></div>
                  {activeCategory !== 'mangalsutras' && (
                    <div className="form-group"><label className='form-label'>Included Components</label><input className="input-field" name="includedComponents" value={formData.includedComponents} onChange={handleChange} /></div>
                  )}
                  <div className="form-group"><label className='form-label'>Generic Name</label><input className="input-field" name="genericName" value={formData.genericName} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Country of Origin <span>*</span></label><input className="input-field" name="countryOfOrigin" value={formData.countryOfOrigin} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Dimension Unit</label><input className="input-field" name="productDimensionUnit" value={formData.productDimensionUnit} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Height</label><input className="input-field" name="productHeight" value={formData.productHeight} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Length</label><input className="input-field" name="productLength" value={formData.productLength} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Width</label><input className="input-field" name="productWidth" value={formData.productWidth} onChange={handleChange} /></div>
                </>
              )}
            </div>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Manufacturer & Packer</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: 'span 2' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Manufacturer</h4>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input className="input-field" placeholder="Name" name="manufacturerName" value={formData.manufacturerName} onChange={handleChange} />
                  <input className="input-field" placeholder="Address" name="manufacturerAddress" value={formData.manufacturerAddress} onChange={handleChange} />
                  <input className="input-field" placeholder="Pincode" name="manufacturerPincode" value={formData.manufacturerPincode} onChange={handleChange} style={{ width: '80px' }} />
                </div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Packer</h4>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input className="input-field" placeholder="Name" name="packerName" value={formData.packerName} onChange={handleChange} />
                  <input className="input-field" placeholder="Address" name="packerAddress" value={formData.packerAddress} onChange={handleChange} />
                  <input className="input-field" placeholder="Pincode" name="packerPincode" value={formData.packerPincode} onChange={handleChange} style={{ width: '80px' }} />
                </div>
              </div>
              {activeCategory !== 'water_bottles' && (
                <div style={{ gridColumn: 'span 2' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Importer</h4>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <input className="input-field" placeholder="Name" name="importerName" value={formData.importerName} onChange={handleChange} />
                    <input className="input-field" placeholder="Address" name="importerAddress" value={formData.importerAddress} onChange={handleChange} />
                    <input className="input-field" placeholder="Pincode" name="importerPincode" value={formData.importerPincode} onChange={handleChange} style={{ width: '80px' }} />
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {previewImage && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close-btn" onClick={() => setPreviewImage(null)}>
              &times;
            </button>
            <div className="modal-body">
              <div className="modal-image-container">
                <img
                  src={`${BACKEND_URL}/single_catalog_images/${encodeURIComponent(previewImage.name)}`}
                  alt={previewImage.name}
                  className="modal-image"
                />
              </div>
              <div className="modal-details-container">
                <h3>Photo Details</h3>
                <div className="details-list">
                  <div className="detail-item">
                    <span className="detail-label">Filename:</span>
                    <span className="detail-value text-mono" title={previewImage.name}>{previewImage.name}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">File Type:</span>
                    <span className="detail-value">{previewImage.name.split('.').pop().toUpperCase()} Image</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">File Size:</span>
                    <span className="detail-value">
                      {previewImage.size ? (() => {
                        const bytes = previewImage.size;
                        const k = 1024;
                        const sizes = ['B', 'KB', 'MB'];
                        const i = Math.floor(Math.log(bytes) / Math.log(k));
                        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
                      })() : 'N/A'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Role:</span>
                    <span className="detail-value">
                      {(() => {
                        const commonFiles = ['_a.jpg', '_b.jpg', '_c.jpg', '_a.png', '_b.png', '_c.png', '_a.jpeg', '_b.jpeg', '_c.jpeg'];
                        const isCommon = commonFiles.some(cf => previewImage.name.toLowerCase().endsWith(cf));
                        return isCommon ? 'Common / Side Photo' : 'Main SKU Photo';
                      })()}
                    </span>
                  </div>
                  {previewImage.mtime && (
                    <div className="detail-item">
                      <span className="detail-label">Last Modified:</span>
                      <span className="detail-value">{new Date(previewImage.mtime).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default SingleCatalogSetup;
